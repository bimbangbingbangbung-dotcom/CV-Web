/**
 * Edit-mode entry point (#admin).
 *
 * Boot order: optional passcode gate → optional draft resume → editor
 * panel. While open, the public page beneath live-previews the draft; a
 * floating pill shows unsaved changes on the public side, and the browser
 * warns before closing the tab with unsaved work.
 *
 * Everything here is code-split: none of it ships in the public bundle.
 */
import './admin.css';
import type { Content } from '../schema/types';
import { h } from '../utils/dom';
import { icon } from '../components/icons';
import { migrate } from '../utils/migrate';
import { validateContent } from '../utils/validate';
import { DraftStore, loadPersistedDraft, clearPersistedDraft } from './state';
import { openPanel } from './panel';

const UNLOCK_KEY = 'cvweb:admin-unlocked';

/**
 * Module-level so every editor instance adds/removes THE SAME listener —
 * a reopened editor can then clear a guard left by a previous close.
 */
let guardAttached = false;
const guard = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
  event.returnValue = '';
};

export interface AdminOptions {
  /** In-progress draft from a previous editor session in this page load. */
  initialDraft?: Content;
  /** Re-render the public page underneath with the current draft. */
  onPreview: (content: Content) => void;
  /** The editor finished closing (clear the #admin hash). */
  onClose: () => void;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Blocking passcode prompt (only when content.json configures a hash). */
function passcodeGate(expectedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', { id: 'gate-input', attrs: { type: 'password', autocomplete: 'current-password' } });
    const error = h('p', { class: 'field-error', attrs: { role: 'alert' } });
    const unlock = h('button', { class: 'btn btn-primary btn-sm', text: 'Unlock', attrs: { type: 'submit' } });
    const cancel = h('button', { class: 'btn btn-ghost btn-sm', text: 'Cancel', attrs: { type: 'button' } });

    const form = h(
      'form',
      { class: 'gate-form' },
      h('label', { text: 'Passcode', attrs: { for: 'gate-input' } }),
      input,
      error,
      h('div', { class: 'dialog-actions' }, cancel, unlock),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void sha256Hex(input.value).then((hex) => {
        if (hex.toLowerCase() === expectedHash.toLowerCase()) {
          try {
            sessionStorage.setItem(UNLOCK_KEY, '1');
          } catch {
            /* ignore */
          }
          root.remove();
          resolve(true);
        } else {
          error.textContent = 'Incorrect passcode.';
          input.select();
        }
      });
    });
    cancel.addEventListener('click', () => {
      root.remove();
      resolve(false);
    });

    const root = h(
      'div',
      { class: 'admin-gate', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editor passcode' } },
      h('div', { class: 'gate-panel' }, icon('pencil'), h('h2', { text: 'This area is protected' }), form),
    );
    document.body.append(root);
    input.focus();
  });
}

/** "Resume draft?" choice for an autosaved draft found in localStorage. */
function resumeDialog(savedAt: string): Promise<'resume' | 'discard' | 'ignore'> {
  return new Promise((resolve) => {
    const resume = h('button', { class: 'btn btn-primary btn-sm', text: 'Resume draft', attrs: { type: 'button' } });
    const discard = h('button', { class: 'btn btn-ghost btn-sm', text: 'Discard draft', attrs: { type: 'button' } });
    const ignore = h('button', { class: 'btn btn-ghost btn-sm', text: 'Keep for later', attrs: { type: 'button' } });
    resume.addEventListener('click', () => {
      dialog.remove();
      resolve('resume');
    });
    discard.addEventListener('click', () => {
      dialog.remove();
      resolve('discard');
    });
    ignore.addEventListener('click', () => {
      dialog.remove();
      resolve('ignore');
    });
    const dialog = h(
      'dialog',
      { class: 'admin-dialog' },
      h('h2', { class: 'dialog-title', text: 'Unsaved draft found' }),
      h('p', {
        class: 'dialog-text',
        text: `You have an autosaved draft from ${new Date(savedAt).toLocaleString()}. Resume it, discard it, or keep it untouched.`,
      }),
      h('div', { class: 'dialog-actions' }, ignore, discard, resume),
    );
    document.body.append(dialog);
    dialog.showModal();
    resume.focus();
  });
}

/** Floating "unsaved draft" indicator on the public side of the editor. */
function createDraftPill(): { el: HTMLElement; button: HTMLElement; setDirty: (dirty: boolean) => void } {
  const button = h(
    'button',
    { class: 'draft-pill', attrs: { type: 'button' } },
    icon('pencil'),
    'Draft in editor — not published',
  );
  const el = h('div', { class: 'draft-pill-wrap', attrs: { hidden: true } }, button);
  return {
    el,
    button,
    setDirty: (dirty: boolean) => {
      el.hidden = !dirty;
    },
  };
}

export function initAdmin(content: Content, options: AdminOptions): () => void {
  let disposed = false;
  let disposePanel: (() => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let dirtyAtClose = false;

  // Dedupe: closing with unsaved work keeps the pill on the public page.
  document.querySelectorAll('.draft-pill-wrap').forEach((el) => el.remove());
  const pill = createDraftPill();

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe?.();
    disposePanel?.();
    if (dirtyAtClose) {
      // Keep the "draft in editor" pill so the owner can jump back in.
      pill.el.classList.add('is-orphaned');
      pill.button.addEventListener('click', () => {
        location.hash = '#admin';
      });
    } else {
      pill.el.remove();
      window.removeEventListener('beforeunload', guard);
    }
  };

  const guard = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
    event.returnValue = '';
  };

  void (async () => {
    // 1. Passcode gate (disabled by default; unlock sticks per session).
    if (content.admin.passcodeSha256) {
      let unlocked = false;
      try {
        unlocked = sessionStorage.getItem(UNLOCK_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (!unlocked) {
        unlocked = await passcodeGate(content.admin.passcodeSha256);
        if (!unlocked) {
          if (!disposed) options.onClose();
          return;
        }
      }
    }
    if (disposed) return;

    // 2. Draft resume — localStorage holds working copies only; publishing
    //    still happens by downloading the file and committing it.
    const store = new DraftStore(content, options.initialDraft);
    const persisted = loadPersistedDraft();
    const openingWith = JSON.stringify(options.initialDraft ?? content);
    if (persisted) {
      const migrated = migrate(persisted.data);
      const validated = migrated.ok ? validateContent(migrated.data) : { ok: false as const, errors: [] };
      if (!validated.ok) {
        clearPersistedDraft(); // corrupt leftover — drop it silently
      } else if (
        JSON.stringify(validated.content) !== openingWith &&
        JSON.stringify(validated.content) !== JSON.stringify(content)
      ) {
        // Only worth asking when the stored draft differs from BOTH the
        // baseline and the draft we are already opening with.
        const choice = await resumeDialog(persisted.savedAt);
        if (disposed) return;
        if (choice === 'resume') store.replace(validated.content, { history: false });
        else if (choice === 'discard') clearPersistedDraft();
      }
    }
    if (disposed) return;

    // 3. Live-wire the draft: preview underlays, pill + unload guard follow
    //    the dirty flag; structural changes (undo/redo/import) re-render the
    //    public page too.
    document.body.append(pill.el);
    unsubscribe = store.subscribe((draft, meta) => {
      dirtyAtClose = store.dirty;
      pill.setDirty(store.dirty);
      if (store.dirty) window.addEventListener('beforeunload', guard);
      else window.removeEventListener('beforeunload', guard);
      if (meta.external) options.onPreview(draft);
    });
    dirtyAtClose = store.dirty;
    pill.setDirty(store.dirty);

    // 4. Open the editor panel.
    disposePanel = openPanel({
      published: content,
      store,
      onPreview: (draft) => options.onPreview(draft),
      onClose: () => {
        cleanup();
        options.onClose();
      },
    });
  })();

  return cleanup;
}
