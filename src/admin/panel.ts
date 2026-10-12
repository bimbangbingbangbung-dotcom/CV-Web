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
import type { Content, SectionEntry } from '../schema/types';
import schemaJson from '../../content.schema.json';
import { DraftStore, clearPersistedDraft } from './state';
import {
  controlFor,
  fieldRow,
  humanize,
  resolveRef,
  type FormContext,
  type SchemaNode,
} from './widgets';
import { diffJson, describeDiff } from './diff';
import { checkAccentPairs } from './contrast';

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
function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'admin-dialog' });
    const confirmBtn = h('button', { class: 'btn btn-primary btn-sm', text: confirmLabel, attrs: { type: 'button' } });
    const cancelBtn = h('button', { class: 'btn btn-ghost btn-sm', text: 'Cancel', attrs: { type: 'button' } });
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

  // --- Toolbar ---
  const dirtyBadge = h('span', { class: 'badge admin-badge' });
  const status = h('span', { class: 'admin-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)');
  const redoBtn = iconButton('redo', 'Redo (Ctrl+Shift+Z)');

  function iconButton(glyph: 'undo' | 'redo', label: string): HTMLButtonElement {
    const btn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': label, title: label } });
    btn.append(icon(glyph));
    return btn;
  }

  undoBtn.addEventListener('click', () => store.undo());
  redoBtn.addEventListener('click', () => store.redo());

  const importInput = h('input', {
    attrs: { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' },
  }) as HTMLInputElement;

  const downloadBtn = h('button', { class: 'btn btn-primary btn-sm', attrs: { type: 'button' } });
  downloadBtn.append(icon('download'), 'Download content.json');

  const publishDownload = (): void => {
    store.set(['meta', 'lastUpdated'], new Date().toISOString().slice(0, 10));
    onPreview(store.draft); // footer "Last updated" reflects immediately
    downloadJson(store.draft, 'content.json');
    status.textContent = 'Downloaded — replace public/content.json in the repo and commit to publish.';
  };
  downloadBtn.addEventListener('click', publishDownload);

  const backupBtn = textButton('Export backup', () => {
    downloadJson(store.draft, `content.backup-${new Date().toISOString().slice(0, 10)}.json`);
    status.textContent = 'Backup exported.';
  });
  const importBtn = textButton('Import', () => importInput.click());
  const diffBtn = textButton('View changes', () => void showDiff());
  const helpBtn = textButton('Help', () => selectTab('help'));
  const closeBtn = h(
    'button',
    { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Close editor', title: 'Close editor' } },
    icon('close'),
  );
  closeBtn.addEventListener('click', () => onClose());

  function textButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = h('button', { class: 'btn btn-ghost btn-sm', text: label, attrs: { type: 'button' } });
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
    const close = h('button', { class: 'btn btn-ghost btn-sm', text: 'Close', attrs: { type: 'button' } });
    close.addEventListener('click', () => dialog.close());
    dialog.append(
      h('h2', { class: 'dialog-title', text: 'Draft vs published content.json' }),
      entries.length === 0
        ? h('p', { class: 'dialog-text', text: 'No differences — the draft matches the published file.' })
        : h(
            'ul',
            { class: 'diff-list' },
            ...entries.map((entry) => h('li', { class: `diff-${entry.kind}`, text: describeDiff(entry) })),
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
      downloadBtn,
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
        attrs: { type: 'button', role: 'tab', id: `tab-${name}`, 'aria-selected': 'false', 'aria-controls': 'admin-panel' },
      });
      btn.addEventListener('click', () => selectTab(name));
      tabButtons.set(name, btn);
      return btn;
    }),
  );

  const body = h('div', { class: 'admin-body', id: 'admin-panel', attrs: { role: 'tabpanel', tabindex: '-1' } });

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
      fieldRow('Last updated', (() => {
        const input = h('input', { id: 'f-meta-lastUpdated', attrs: { type: 'date' } });
        input.value = draft.meta.lastUpdated;
        input.addEventListener('change', () => ctx.onCommit(['meta', 'lastUpdated'], input.value));
        return input;
      })(), 'Shown in the footer and sitemap — set automatically when you download.'),
      h('p', { class: 'admin-help', text: `Schema version ${draft.meta.schemaVersion} (managed by the site).` }),
    );
    return h('div', {}, ...groups.filter((g): g is HTMLElement => g !== null), metaGroup);
  }

  function renderAppearanceTab(): HTMLElement {
    const draft = store.draft;
    const accentNode = rootSchema.properties?.['appearance']?.properties ?? {};
    const light = controlFor(['appearance', 'accent'], accentNode['accent'] ?? {}, draft.appearance.accent, ctx);
    const dark = controlFor(['appearance', 'accentDark'], accentNode['accentDark'] ?? {}, draft.appearance.accentDark, ctx);

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
      h(
        'div',
        {},
        h('h3', { class: 'admin-subtitle', text: 'WCAG contrast check' }),
        table,
      ),
    );
  }

  function renderSectionsTab(): HTMLElement {
    const sections = store.draft.sections;
    const move = (index: number, delta: number): void => {
      const copy = [...sections];
      const [moved] = copy.splice(index, 1);
      copy.splice(index + delta, 0, moved);
      ctx.onCommit(['sections'], copy); // array → re-renders + live-previews
      announce(`Moved ${moved?.label ?? 'section'} to position ${index + delta + 1}`);
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

      const up = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': `Move ${section.label} up`, disabled: index === 0 } }, icon('arrow-up'));
      up.addEventListener('click', () => move(index, -1));
      const down = h('button', { class: 'icon-btn icon-btn-down', attrs: { type: 'button', 'aria-label': `Move ${section.label} down`, disabled: index === sections.length - 1 } }, icon('arrow-up'));
      down.addEventListener('click', () => move(index, 1));

      return h(
        'li',
        { class: 'section-row' },
        h('code', { class: 'section-id', text: section.id }),
        h('div', { class: 'admin-field' }, h('label', { text: 'Heading', attrs: { for: `sec-label-${section.id}` } }), labelInput),
        h('div', { class: 'admin-field section-enabled' }, enabled, h('label', { text: 'Enabled', attrs: { for: `sec-enabled-${section.id}` } })),
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
      h(
        'li',
        {},
        h('kbd', { text: keys }),
        description,
      );
    return h(
      'div',
      { class: 'help-panel' },
      h('h3', { class: 'admin-subtitle', text: 'How publishing works' }),
      h('p', {
        class: 'admin-help',
        text: 'Edits here are a local draft (autosaved in your browser). "Download content.json" writes the finished file — put it at public/content.json in the repo and commit; the site rebuilds and deploys automatically.',
      }),
      h('h3', { class: 'admin-subtitle', text: 'Shortcuts' }),
      h(
        'ul',
        { class: 'shortcut-list' },
        shortcut('Ctrl/⌘ + Z', ' Undo last change'),
        shortcut('Ctrl/⌘ + Shift + Z', ' Redo'),
        shortcut('Ctrl/⌘ + S', ' Download content.json'),
        shortcut('Esc', ' Close dialogs'),
        shortcut('M', ' Toggle header (public site)'),
        shortcut('T', ' Toggle theme (public site)'),
      ),
      h('h3', { class: 'admin-subtitle', text: 'Unsaved changes' }),
      h('p', {
        class: 'admin-help',
        text: 'The "Draft" badge shows whether your draft differs from the published file, and the browser warns before you close the tab with unsaved work.',
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
      publishDownload();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // --- Mount ---
  const root = h(
    'div',
    { class: 'admin-root', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Content editor', tabindex: '-1' } },
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
