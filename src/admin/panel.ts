/**
 * Edit-mode panel — the shell around the schema-driven forms.
 *
 * Layout: fixed toolbar (undo/redo, import/export, publish-download,
 * resets, diff, help, close), tab strip (Content / Appearance / Sections /
 * Help) and a body rebuilt per tab. Field edits never re-render the form
 * (focus is preserved); structural changes (undo/import/reset) do.
 */
import { h, clear } from '../utils/dom';
import { icon } from '../components/icons';
import { safeAssetPath } from '../utils/url';
import type { Content, SectionEntry } from '../schema/types';
import schemaJson from '../../content.schema.json';
import { DraftStore, clearPersistedDraft } from './state';
import {
  controlFor,
  fieldRow,
  humanize,
  resolveRef,
  textControl,
  valueSchema,
  type FormContext,
  type SchemaNode,
} from './widgets';
import { diffJson, describeDiff } from './diff';
import { checkAccentPairs } from './contrast';
import { dataUrlToBytes, isDataImage, optimizePhoto, PhotoError } from './image';
import {
  clearToken,
  commitContent,
  describeApiError,
  detectRepo,
  encodeBase64Bytes,
  getToken,
  isConfigured,
  loadSettings,
  putFile,
  saveSettings,
  setToken,
  testConnection,
  validateConfig,
  type RepoSettings,
} from './github';

const rootSchema = schemaJson as unknown as SchemaNode;

/** Top-level content sections rendered in the Content tab (in schema order). */
const CONTENT_KEYS = [
  'site',
  'header',
  'theme',
  'cv',
  'owner',
  'education',
  'skills',
  'projects',
  'experience',
  'achievements',
  'publications',
  'references',
  'contact',
  'admin',
  'footer',
] as const;

type TabName = 'content' | 'appearance' | 'sections' | 'help';

export interface PanelOptions {
  published: Content;
  store: DraftStore;
  onPreview: (draft: Content) => void;
  onClose: () => void;
}

/** Blob download helper (publish = "download the file and commit it"). */
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { attrs: { href: url, download: filename } });
  link.click();
  URL.revokeObjectURL(url);
}

/** Native <dialog> confirmation naming the exact action (per the brief). */
function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'admin-dialog' });
    const confirmBtn = h('button', {
      class: 'btn btn-primary btn-sm',
      text: confirmLabel,
      attrs: { type: 'button' },
    });
    const cancelBtn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Cancel',
      attrs: { type: 'button' },
    });
    confirmBtn.addEventListener('click', () => {
      dialog.close();
      resolve(true);
    });
    cancelBtn.addEventListener('click', () => {
      dialog.close();
      resolve(false);
    });
    dialog.append(
      h('h2', { class: 'dialog-title', text: title }),
      h('p', { class: 'dialog-text', text: message }),
      h('div', { class: 'dialog-actions' }, cancelBtn, confirmBtn),
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    cancelBtn.focus();
  });
}

/**
 * Transient save confirmation, appended to <body> so it survives the panel
 * closing — pressing Save returns you to the home page (the changes are
 * already live underneath) with this toast still on screen.
 */
function showSaveToast(message: string): void {
  document.querySelectorAll('.save-toast').forEach((el) => el.remove());
  const toast = h('div', { class: 'save-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
  const dismiss = h('button', {
    class: 'save-toast-close',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Dismiss notification' },
  });
  toast.append(h('span', { text: message }), dismiss);
  dismiss.addEventListener('click', () => toast.remove());
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 8000);
}

export function openPanel(options: PanelOptions): () => void {
  const { store, onPreview, onClose } = options;
  let activeTab: TabName = 'content';

  // --- Shared form context ---
  const live = h('div', { class: 'admin-live', attrs: { role: 'status', 'aria-live': 'polite' } });
  const announce = (message: string): void => {
    live.textContent = message;
  };
  const ctx: FormContext = {
    rootSchema,
    onCommit: (path, value) => {
      store.set(path, value);
      onPreview(store.draft);
      // Structural edits (list add/remove/reorder) change the DOM shape —
      // rebuild the form but return focus to wherever the user was.
      if (Array.isArray(value)) renderPreservingFocus();
    },
    announce,
    customControls: { 'owner.photo': photoControl },
  };

  /**
   * Re-render the active tab without dropping keyboard focus: remember the
   * focused element's id, rebuild, restore (fallback: the panel root).
   */
  const renderPreservingFocus = (): void => {
    const active = document.activeElement as HTMLElement | null;
    const id = active?.id || null;
    const wasInsidePanel =
      active === document.body || (active !== null && active.closest('.admin-root') !== null);
    renderActiveTab();
    if (id) document.getElementById(id)?.focus();
    else if (wasInsidePanel) root.focus();
  };

  /**
   * owner.photo widget: path/URL field + live thumbnail + upload/remove.
   * An uploaded file is optimized to a JPEG data URL (image.ts) so preview,
   * undo, draft autosave and Download all see it; "Save to GitHub" then
   * commits it as assets/photo.jpg and stores the plain path instead.
   */
  function photoControl(
    path: (string | number)[],
    rawNode: SchemaNode,
    value: unknown,
    formCtx: FormContext,
  ): HTMLElement {
    const node = valueSchema(rawNode, formCtx.rootSchema);
    const input = textControl(path, node, value, formCtx);
    const maxKB = store.draft.admin.imageMaxKB;

    const thumb = h('img', { class: 'photo-thumb', attrs: { alt: '', 'aria-hidden': 'true' } });
    const placeholder = h('span', {
      class: 'photo-thumb photo-thumb-empty',
      text: 'No photo',
      attrs: { 'aria-hidden': 'true' },
    });
    const uploadBtn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Upload photo',
      attrs: { type: 'button' },
    });
    const removeBtn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Remove photo',
      attrs: { type: 'button' },
    });
    const fileInput = h('input', {
      attrs: {
        type: 'file',
        accept: 'image/jpeg,image/png,image/webp',
        hidden: true,
        'aria-hidden': 'true',
        tabindex: '-1',
      },
    });
    fileInput.id = 'f-owner-photo-file';

    /** Reflect the current value into the thumbnail + remove button. */
    const sync = (raw: string): void => {
      const url = raw ? safeAssetPath(raw) : null;
      if (url) {
        thumb.src = url;
        thumb.hidden = false;
        placeholder.hidden = true;
        removeBtn.disabled = false;
      } else {
        thumb.removeAttribute('src');
        thumb.hidden = true;
        placeholder.hidden = false;
        removeBtn.disabled = true;
      }
    };
    sync(typeof value === 'string' ? value : '');

    const processFile = async (file: File): Promise<void> => {
      uploadBtn.disabled = true;
      const before = Math.max(1, Math.round(file.size / 1024));
      status.textContent = `Optimizing photo (${before} KB)…`;
      try {
        const dataUrl = await optimizePhoto(file, maxKB);
        formCtx.onCommit(path, dataUrl);
        input.value = dataUrl;
        sync(dataUrl);
        const payloadLength = dataUrl.length - (dataUrl.indexOf(',') + 1);
        const after = Math.max(1, Math.round((payloadLength * 3) / 4 / 1024));
        status.textContent = `Photo updated (${after} KB) — Save to GitHub or Download content.json to publish it.`;
        formCtx.announce('Photo updated — save to publish it.');
      } catch (error) {
        const detail =
          error instanceof PhotoError ? error.message : 'could not process that image.';
        status.textContent = `Photo upload failed — ${detail}`;
        formCtx.announce('Photo upload failed.');
      } finally {
        uploadBtn.disabled = false;
        fileInput.value = ''; // same file can be picked again
      }
    };

    // The path/URL can also be typed by hand — keep the preview in step.
    input.addEventListener('change', () => sync(input.value));
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void processFile(file);
    });
    removeBtn.addEventListener('click', () => {
      formCtx.onCommit(path, null);
      input.value = '';
      sync('');
      status.textContent = 'Photo removed — the initials avatar will show instead.';
      formCtx.announce('Photo removed.');
    });

    return h(
      'div',
      { class: 'photo-edit', attrs: { 'data-label-target': input.id } },
      h('div', { class: 'photo-edit-main' }, thumb, placeholder, input),
      h('div', { class: 'photo-edit-actions' }, uploadBtn, removeBtn, fileInput),
      h('p', {
        class: 'admin-help',
        text: `JPG, PNG or WebP — resized and optimized to ${maxKB} KB or less. Save to GitHub commits the picture as an image file; Download keeps it inside content.json.`,
      }),
    );
  }

  // --- Toolbar ---
  const dirtyBadge = h('span', { class: 'badge admin-badge' });
  const status = h('span', {
    class: 'admin-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)');
  const redoBtn = iconButton('redo', 'Redo (Ctrl+Shift+Z)');
  // Stable ids so focus can be restored across form re-renders.
  undoBtn.id = 'admin-undo';
  redoBtn.id = 'admin-redo';

  function iconButton(glyph: 'undo' | 'redo', label: string): HTMLButtonElement {
    const btn = h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': label, title: label },
    });
    btn.append(icon(glyph));
    return btn;
  }

  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());

  const importInput = h('input', {
    attrs: {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      'aria-hidden': 'true',
      tabindex: '-1',
    },
  });
  importInput.id = 'admin-import-input'; // stable target for tests + focus restore

  const downloadBtn = h('button', { class: 'btn btn-ghost btn-sm', attrs: { type: 'button' } });
  downloadBtn.id = 'admin-download';
  downloadBtn.append(icon('download'), 'Download content.json');

  const publishDownload = (): void => {
    store.set(['meta', 'lastUpdated'], new Date().toISOString().slice(0, 10));
    onPreview(store.draft); // footer "Last updated" reflects immediately
    downloadJson(store.draft, 'content.json');
    status.textContent =
      'Downloaded — replace public/content.json in the repo and commit to publish.';
  };
  downloadBtn.addEventListener('click', publishDownload);

  // --- Save to GitHub (Contents API commit → deploy workflow picks it up) ---
  const saveBtn = h('button', { class: 'btn btn-primary btn-sm', attrs: { type: 'button' } });
  saveBtn.id = 'admin-save';
  saveBtn.append(icon('save'), 'Save to GitHub');
  let saving = false;

  const publishToGitHub = async (): Promise<void> => {
    if (saving) return;
    const settings = loadSettings();
    const token = getToken();
    if (!settings.owner || !settings.repo) {
      status.textContent =
        'GitHub publishing needs setup — opening the Help tab (GitHub publishing section).';
      selectTab('help');
      document.getElementById('f-gh-owner')?.focus();
      return;
    }
    if (!token) {
      status.textContent = 'Add a GitHub token first — Help tab → GitHub publishing.';
      selectTab('help');
      document.getElementById('f-gh-token')?.focus();
      return;
    }
    const configErrors = validateConfig(settings);
    if (configErrors.length > 0) {
      status.textContent = `GitHub settings invalid — ${configErrors[0]}`;
      selectTab('help');
      return;
    }
    const check = DraftStore.parseContent(store.draft);
    if (!check.ok) {
      status.textContent = `Not saved — the draft has ${check.errors.length} schema problem(s). Use Import or Reset draft to recover.`;
      return;
    }

    saving = true;
    saveBtn.disabled = true;
    status.textContent = `Saving to ${settings.owner}/${settings.repo}…`;
    try {
      store.set(['meta', 'lastUpdated'], new Date().toISOString().slice(0, 10));
      onPreview(store.draft); // footer "Last updated" reflects immediately
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

      // An uploaded photo travels as a data URL in the draft; commit it as a
      // real file FIRST so the published content.json stays small and fast.
      // If the content commit then fails, the draft already points at the
      // (now existing) file, so a plain retry just re-commits content.json.
      let photoNote = '';
      const photo = store.draft.owner.photo;
      if (isDataImage(photo)) {
        const bytes = dataUrlToBytes(photo);
        if (bytes) {
          const slash = settings.path.lastIndexOf('/');
          const dir = slash === -1 ? '' : settings.path.slice(0, slash);
          const assetPath = `${dir ? `${dir}/` : ''}assets/photo.jpg`;
          status.textContent = `Uploading photo to ${settings.owner}/${settings.repo}…`;
          await putFile({
            owner: settings.owner,
            repo: settings.repo,
            branch: settings.branch,
            path: assetPath,
            token,
            contentBase64: encodeBase64Bytes(bytes),
            message: `content: upload photo via #admin editor (${stamp} UTC)`,
          });
          store.set(['owner', 'photo'], './assets/photo.jpg');
          onPreview(store.draft);
          photoNote = ` Photo committed to ${assetPath} (shows up with the redeploy).`;
        }
      }

      const json = `${JSON.stringify(store.draft, null, 2)}\n`;
      await commitContent({
        owner: settings.owner,
        repo: settings.repo,
        branch: settings.branch,
        path: settings.path,
        token,
        content: json,
        message: `content: update via #admin editor (${stamp} UTC)`,
      });
      store.markSaved(); // badge → "Matches published", pill + unload guard clear
      const savedMessage = `Saved to ${settings.owner}/${settings.repo} (${settings.branch}) — GitHub Actions redeploys the site in ~1–2 minutes.${photoNote}`;
      status.textContent = savedMessage;
      showSaveToast(savedMessage);
      onClose(); // real-time result: return to the home page with the changes visible
    } catch (error) {
      status.textContent = `Save failed — ${describeApiError(error)}`;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  };
  saveBtn.addEventListener('click', () => void publishToGitHub());

  const backupBtn = textButton('Export backup', () => {
    downloadJson(store.draft, `content.backup-${new Date().toISOString().slice(0, 10)}.json`);
    status.textContent = 'Backup exported.';
  });
  const importBtn = textButton('Import', () => importInput.click());
  const diffBtn = textButton('View changes', () => void showDiff());
  const helpBtn = textButton('Help', () => selectTab('help'));
  const closeBtn = h(
    'button',
    {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': 'Close editor', title: 'Close editor' },
    },
    icon('close'),
  );
  closeBtn.addEventListener('click', () => onClose());

  function textButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: label,
      attrs: { type: 'button' },
    });
    btn.addEventListener('click', onClick);
    return btn;
  }

  const resetDraftBtn = textButton('Reset draft', () => {
    void confirmAction(
      'Reset draft to published content?',
      'Your draft edits in this editor are discarded and the form reloads from the published content.json. Nothing in the repository is changed.',
      'Reset draft',
    ).then((yes) => {
      if (!yes) return;
      store.resetToPublished();
      onPreview(store.draft);
      status.textContent = 'Draft reset to published content.';
    });
  });

  const resetPublishedBtn = textButton('Reset published content', () => {
    void confirmAction(
      'Reset published content?',
      'This clears your locally saved draft and reloads the site from the published public/content.json. Anything you did not download is lost.',
      'Reset and reload',
    ).then((yes) => {
      if (!yes) return;
      clearPersistedDraft();
      window.location.reload();
    });
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    void file.text().then((text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        status.textContent = `Import failed: not valid JSON (${String(cause)})`;
        return;
      }
      const result = DraftStore.parseContent(parsed);
      if (!result.ok) {
        status.textContent = `Import failed: ${result.errors.length} schema problem(s) — first: ${result.errors[0]?.path} ${result.errors[0]?.message}`;
        return;
      }
      store.replace(result.content);
      onPreview(store.draft);
      status.textContent = `Imported ${file.name}.`;
    });
  });

  async function showDiff(): Promise<void> {
    const entries = diffJson(options.published, store.draft);
    const dialog = h('dialog', { class: 'admin-dialog diff-dialog' });
    const close = h('button', {
      class: 'btn btn-ghost btn-sm',
      text: 'Close',
      attrs: { type: 'button' },
    });
    close.addEventListener('click', () => dialog.close());
    dialog.append(
      h('h2', { class: 'dialog-title', text: 'Draft vs published content.json' }),
      entries.length === 0
        ? h('p', {
            class: 'dialog-text',
            text: 'No differences — the draft matches the published file.',
          })
        : h(
            'ul',
            { class: 'diff-list' },
            ...entries.map((entry) =>
              h('li', { class: `diff-${entry.kind}`, text: describeDiff(entry) }),
            ),
          ),
      h('div', { class: 'dialog-actions' }, close),
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
    close.focus();
  }

  const bar = h(
    'div',
    { class: 'admin-bar' },
    h(
      'div',
      { class: 'admin-bar-title' },
      h('strong', { text: 'Editing' }),
      h('code', { text: 'public/content.json' }),
      dirtyBadge,
    ),
    h(
      'div',
      { class: 'admin-bar-actions' },
      undoBtn,
      redoBtn,
      importBtn,
      backupBtn,
      diffBtn,
      saveBtn,
      resetDraftBtn,
      resetPublishedBtn,
      helpBtn,
      closeBtn,
    ),
    status,
  );

  // --- Tabs ---
  const tabNames: [TabName, string][] = [
    ['content', 'Content'],
    ['appearance', 'Appearance'],
    ['sections', 'Sections'],
    ['help', 'Help'],
  ];
  const tabButtons = new Map<TabName, HTMLButtonElement>();
  const tabBar = h(
    'div',
    { class: 'admin-tabs', attrs: { role: 'tablist', 'aria-label': 'Editor sections' } },
    ...tabNames.map(([name, label]) => {
      const btn = h('button', {
        class: 'admin-tab',
        text: label,
        attrs: {
          type: 'button',
          role: 'tab',
          id: `tab-${name}`,
          'aria-selected': 'false',
          'aria-controls': 'admin-panel',
        },
      });
      btn.addEventListener('click', () => selectTab(name));
      tabButtons.set(name, btn);
      return btn;
    }),
  );

  const body = h('div', {
    class: 'admin-body',
    id: 'admin-panel',
    attrs: { role: 'tabpanel', tabindex: '-1' },
  });

  // --- Tab renderers ---
  function renderContentTab(): HTMLElement {
    const draft = store.draft;
    const groups = CONTENT_KEYS.map((key) => {
      const node = resolveRef(rootSchema.properties?.[key] ?? {}, rootSchema);
      const control = controlFor([key], node, draft[key], ctx);
      if (!control) return null;
      return h(
        'fieldset',
        { class: 'admin-group' },
        h('legend', { text: humanize(key) }),
        node.description ? h('p', { class: 'admin-help', text: node.description }) : null,
        control,
      );
    });
    const metaGroup = h(
      'fieldset',
      { class: 'admin-group' },
      h('legend', { text: 'Meta' }),
      fieldRow(
        'Last updated',
        (() => {
          const input = h('input', { id: 'f-meta-lastUpdated', attrs: { type: 'date' } });
          input.value = draft.meta.lastUpdated;
          input.addEventListener('change', () =>
            ctx.onCommit(['meta', 'lastUpdated'], input.value),
          );
          return input;
        })(),
        'Shown in the footer and sitemap — set automatically when you download.',
      ),
      h('p', {
        class: 'admin-help',
        text: `Schema version ${draft.meta.schemaVersion} (managed by the site).`,
      }),
    );
    return h('div', {}, ...groups.filter((g): g is HTMLFieldSetElement => g !== null), metaGroup);
  }

  function renderAppearanceTab(): HTMLElement {
    const draft = store.draft;
    const accentNode = rootSchema.properties?.['appearance']?.properties ?? {};
    const light = controlFor(
      ['appearance', 'accent'],
      accentNode['accent'] ?? {},
      draft.appearance.accent,
      ctx,
    );
    const dark = controlFor(
      ['appearance', 'accentDark'],
      accentNode['accentDark'] ?? {},
      draft.appearance.accentDark,
      ctx,
    );

    const table = h(
      'table',
      { class: 'contrast-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { text: 'Combination', attrs: { scope: 'col' } }),
          h('th', { text: 'Ratio', attrs: { scope: 'col' } }),
          h('th', { text: 'AA (4.5:1)', attrs: { scope: 'col' } }),
          h('th', { text: 'AA large/UI (3:1)', attrs: { scope: 'col' } }),
        ),
      ),
      h(
        'tbody',
        {},
        ...checkAccentPairs(draft.appearance.accent, draft.appearance.accentDark).map((check) =>
          h(
            'tr',
            {},
            h('td', { text: check.label }),
            h('td', { class: 'mono', text: `${check.ratio.toFixed(2)}:1` }),
            h('td', { text: check.aa ? 'Pass' : 'Fail' }),
            h('td', { text: check.aaLarge ? 'Pass' : 'Fail' }),
          ),
        ),
      ),
    );

    return h(
      'div',
      { class: 'appearance-grid' },
      h(
        'div',
        {},
        h('h3', { class: 'admin-subtitle', text: 'Accent color' }),
        light,
        dark,
        h('p', {
          class: 'admin-help',
          text: 'Applies to links, buttons and highlights. The checker below evaluates your colors against the site palette on both themes.',
        }),
      ),
      h('div', {}, h('h3', { class: 'admin-subtitle', text: 'WCAG contrast check' }), table),
    );
  }

  function renderSectionsTab(): HTMLElement {
    const sections = store.draft.sections;
    const move = (index: number, delta: number): void => {
      const copy = [...sections];
      const [moved] = copy.splice(index, 1);
      if (!moved) return;
      copy.splice(index + delta, 0, moved);
      ctx.onCommit(['sections'], copy); // array → re-renders + live-previews
      announce(`Moved ${moved.label} to position ${index + delta + 1}`);
    };

    const rows = sections.map((section: SectionEntry, index: number) => {
      const labelInput = h('input', { id: `sec-label-${section.id}`, attrs: { type: 'text' } });
      labelInput.value = section.label;
      labelInput.addEventListener('change', () =>
        ctx.onCommit(['sections', index, 'label'], labelInput.value),
      );

      const enabled = h('input', { id: `sec-enabled-${section.id}`, attrs: { type: 'checkbox' } });
      enabled.checked = section.enabled;
      enabled.addEventListener('change', () =>
        ctx.onCommit(['sections', index, 'enabled'], enabled.checked),
      );

      const up = h(
        'button',
        {
          class: 'icon-btn',
          attrs: {
            type: 'button',
            'aria-label': `Move ${section.label} up`,
            disabled: index === 0,
          },
        },
        icon('arrow-up'),
      );
      up.addEventListener('click', () => move(index, -1));
      const down = h(
        'button',
        {
          class: 'icon-btn icon-btn-down',
          attrs: {
            type: 'button',
            'aria-label': `Move ${section.label} down`,
            disabled: index === sections.length - 1,
          },
        },
        icon('arrow-up'),
      );
      down.addEventListener('click', () => move(index, 1));

      return h(
        'li',
        { class: 'section-row' },
        h('code', { class: 'section-id', text: section.id }),
        h(
          'div',
          { class: 'admin-field' },
          h('label', { text: 'Heading', attrs: { for: `sec-label-${section.id}` } }),
          labelInput,
        ),
        h(
          'div',
          { class: 'admin-field section-enabled' },
          enabled,
          h('label', { text: 'Enabled', attrs: { for: `sec-enabled-${section.id}` } }),
        ),
        h('div', { class: 'list-buttons' }, up, down),
      );
    });

    return h(
      'div',
      {},
      h('p', {
        class: 'admin-help',
        text: 'Order and headings here drive the header navigation and the page itself. Disabled sections disappear from both.',
      }),
      h('ul', { class: 'section-rows' }, ...rows),
    );
  }

  function renderHelpTab(): HTMLElement {
    const shortcut = (keys: string, description: string): HTMLElement =>
      h('li', {}, h('kbd', { text: keys }), description);

    // --- GitHub publishing settings (backing the Save-to-GitHub button) ---
    const settings = loadSettings();
    // No stored owner/repo yet → pre-fill from the deployed URL or canonical.
    const detected =
      settings.owner && settings.repo
        ? null
        : detectRepo(window.location.href, store.draft.site.canonicalUrl);
    const existingToken = getToken();

    const ownerInput = h('input', {
      id: 'f-gh-owner',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' },
    });
    ownerInput.value = settings.owner || detected?.owner || '';
    const repoInput = h('input', {
      id: 'f-gh-repo',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' },
    });
    repoInput.value = settings.repo || detected?.repo || '';
    const branchInput = h('input', {
      id: 'f-gh-branch',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' },
    });
    branchInput.value = settings.branch;
    const pathInput = h('input', {
      id: 'f-gh-path',
      attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' },
    });
    pathInput.value = settings.path;
    const tokenInput = h('input', {
      id: 'f-gh-token',
      attrs: { type: 'password', autocomplete: 'new-password', spellcheck: 'false' },
    });
    tokenInput.placeholder = existingToken
      ? 'A token is saved — type to replace it'
      : 'ghp_… or github_pat_…';
    const rememberInput = h('input', { id: 'f-gh-remember', attrs: { type: 'checkbox' } });
    rememberInput.checked = settings.rememberToken;

    const collect = (): RepoSettings => ({
      owner: ownerInput.value.trim(),
      repo: repoInput.value.trim(),
      branch: branchInput.value.trim() || 'main',
      path: pathInput.value.trim() || 'public/content.json',
      rememberToken: rememberInput.checked,
    });
    for (const input of [ownerInput, repoInput, branchInput, pathInput]) {
      input.addEventListener('change', () => saveSettings(collect()));
    }
    rememberInput.addEventListener('change', () => {
      const token = getToken();
      if (token) setToken(token, rememberInput.checked); // relocate saved token
      saveSettings(collect());
    });
    tokenInput.addEventListener('change', () => {
      const value = tokenInput.value.trim();
      if (!value) return; // blank = keep the already saved token
      setToken(value, rememberInput.checked);
      tokenInput.value = '';
      tokenInput.placeholder = 'A token is saved — type to replace it';
      status.textContent = 'GitHub token saved.';
    });

    const runTest = async (): Promise<void> => {
      const config = collect();
      saveSettings(config);
      const errors = validateConfig(config);
      if (errors.length > 0) {
        status.textContent = `Settings invalid — ${errors[0]}`;
        return;
      }
      const token = getToken();
      if (!token) {
        status.textContent = 'No token saved yet — paste one above first.';
        tokenInput.focus();
        return;
      }
      status.textContent = 'Testing connection…';
      try {
        const name = await testConnection(config, token);
        status.textContent = `Connected to ${name} ✓`;
      } catch (error) {
        status.textContent = `Connection failed — ${describeApiError(error)}`;
      }
    };
    const testBtn = textButton('Test connection', () => void runTest());
    const forgetBtn = textButton('Forget saved token', () => {
      clearToken();
      tokenInput.placeholder = 'ghp_… or github_pat_…';
      status.textContent = 'Saved token cleared.';
    });

    return h(
      'div',
      { class: 'help-panel' },
      h('h3', { class: 'admin-subtitle', text: 'How publishing works' }),
      h('p', {
        class: 'admin-help',
        text: 'Edits here are a local draft (autosaved in your browser). "Save to GitHub" commits public/content.json straight to your repository and the deploy workflow rebuilds the site in ~1–2 minutes. "Download content.json" is the manual alternative — commit the file yourself.',
      }),
      h('h3', { class: 'admin-subtitle', text: 'GitHub publishing' }),
      h('p', {
        class: 'admin-help',
        text: 'Connect your repository once — then Save to GitHub works from the toolbar. The token stays in this browser (session only, unless "remember" is checked) and is only ever sent to api.github.com.',
      }),
      h(
        'div',
        { class: 'gh-grid' },
        fieldRow(
          'Owner',
          ownerInput,
          'GitHub user or organization — auto-detected from the deployed URL when empty.',
          true,
        ),
        fieldRow('Repository', repoInput, 'e.g. CV-Web.', true),
        fieldRow('Branch', branchInput, undefined, true),
        fieldRow('File path', pathInput, 'Where content.json lives in the repo.', true),
        fieldRow(
          'GitHub token',
          tokenInput,
          'Fine-grained token with Contents → Read and write (Settings → Developer settings).',
          true,
        ),
        fieldRow('Remember token on this device', rememberInput, 'Off = this session only.'),
      ),
      h('div', { class: 'gh-actions' }, testBtn, forgetBtn),
      h('p', {
        class: 'admin-help',
        text: 'Manual alternative — Download content.json writes the finished file to your computer so you can replace public/content.json in the repository and commit it yourself, without a token.',
      }),
      h('div', { class: 'gh-actions' }, downloadBtn),
      h('h3', { class: 'admin-subtitle', text: 'Shortcuts' }),
      h(
        'ul',
        { class: 'shortcut-list' },
        shortcut('Ctrl/⌘ + Z', ' Undo last change'),
        shortcut('Ctrl/⌘ + Shift + Z', ' Redo'),
        shortcut('Ctrl/⌘ + S', ' Save to GitHub (Download when GitHub publishing isn’t set up)'),
        shortcut('Esc', ' Close dialogs'),
        shortcut('M', ' Toggle header (public site)'),
        shortcut('T', ' Toggle theme (public site)'),
      ),
      h('h3', { class: 'admin-subtitle', text: 'Unsaved changes' }),
      h('p', {
        class: 'admin-help',
        text: 'The "Draft" badge shows whether your draft differs from the published file, and the browser warns before you close the tab with unsaved work. After a successful Save to GitHub the draft is marked published.',
      }),
    );
  }

  const tabRenderers: Record<TabName, () => HTMLElement> = {
    content: renderContentTab,
    appearance: renderAppearanceTab,
    sections: renderSectionsTab,
    help: renderHelpTab,
  };

  function renderActiveTab(): void {
    clear(body);
    body.append(tabRenderers[activeTab]());
  }

  function selectTab(name: TabName): void {
    activeTab = name;
    for (const [tab, btn] of tabButtons) {
      const selected = tab === name;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    }
    renderActiveTab();
  }

  // --- Status badges + store subscription ---
  function updateBadges(): void {
    const dirty = store.dirty;
    dirtyBadge.textContent = dirty ? 'Draft — unsaved' : 'Matches published';
    dirtyBadge.classList.toggle('badge-accent', dirty);
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
  }

  const unsubscribe = store.subscribe((_draft, meta) => {
    updateBadges();
    // Field edits keep the DOM (and focus) intact; structural changes rebuild.
    if (meta.external || activeTab === 'appearance') renderPreservingFocus();
  });

  // --- Keyboard shortcuts inside the editor ---
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    } else if (key === 'y') {
      event.preventDefault();
      store.redo();
    } else if (key === 's') {
      event.preventDefault();
      // Save to GitHub when publishing is configured; plain download otherwise.
      if (isConfigured(loadSettings(), getToken())) void publishToGitHub();
      else publishDownload();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // --- Mount ---
  const root = h(
    'div',
    {
      class: 'admin-root',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Content editor',
        tabindex: '-1',
      },
    },
    bar,
    tabBar,
    body,
    live,
    importInput,
  );
  document.body.append(root);
  document.body.classList.add('admin-open');
  selectTab('content');
  updateBadges();
  root.focus();

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKeyDown);
    document.body.classList.remove('admin-open');
    root.remove();
  };
}
