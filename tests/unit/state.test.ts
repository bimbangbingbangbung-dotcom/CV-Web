/**
 * DraftStore: history, dirty tracking, path commits (jsdom provides
 * localStorage + structuredClone via Node).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DraftStore } from '../../src/admin/state';
import { DEFAULT_CONTENT } from '../../src/schema/defaults';
import type { Content } from '../../src/schema/types';

const published = (): Content => structuredClone(DEFAULT_CONTENT);

describe('DraftStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts clean and reports dirtiness after a change', () => {
    const store = new DraftStore(published());
    expect(store.dirty).toBe(false);
    store.set(['owner', 'fullName'], 'Maria Clara');
    expect(store.dirty).toBe(true);
    expect(store.draft.owner.fullName).toBe('Maria Clara');
  });

  it('undo and redo walk the history', () => {
    const store = new DraftStore(published());
    store.set(['owner', 'fullName'], 'One');
    store.set(['owner', 'fullName'], 'Two');
    store.undo();
    expect(store.draft.owner.fullName).toBe('One');
    store.undo();
    expect(store.draft.owner.fullName).toBe(DEFAULT_CONTENT.owner.fullName);
    expect(store.canUndo).toBe(false);
    store.redo();
    expect(store.draft.owner.fullName).toBe('One');
  });

  it('a new change clears the redo stack', () => {
    const store = new DraftStore(published());
    store.set(['owner', 'fullName'], 'One');
    store.undo();
    store.set(['owner', 'fullName'], 'Fresh');
    expect(store.canRedo).toBe(false);
    expect(store.draft.owner.fullName).toBe('Fresh');
  });

  it('set() commits nested array paths immutably', () => {
    const store = new DraftStore(published());
    const before = store.draft.projects;
    store.set(['projects', 0, 'title'], 'Renamed project');
    expect(store.draft.projects[0]?.title).toBe('Renamed project');
    expect(before[0]?.title).not.toBe('Renamed project'); // original untouched
  });

  it('resetToPublished restores the published snapshot', () => {
    const store = new DraftStore(published());
    store.set(['owner', 'fullName'], 'Temporary');
    store.resetToPublished();
    expect(store.draft.owner.fullName).toBe(DEFAULT_CONTENT.owner.fullName);
    expect(store.dirty).toBe(false);
  });

  it('caps history at 50 entries', () => {
    const store = new DraftStore(published());
    for (let i = 0; i < 75; i++) store.set(['owner', 'fullName'], `Name ${i}`);
    let undos = 0;
    while (store.undo()) undos++;
    expect(undos).toBe(50);
  });
});
