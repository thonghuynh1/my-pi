// Local UTF-8 editing only. Use Herdr's compare-and-swap writer, never shell redirection.
export const EDIT_LIMIT = 400000;

export class FileDocument {
  constructor(path, disk, { on = null, storage, write }) {
    this.path = path; this.storage = storage; this.write = write;
    this.key = `editor-draft:${JSON.stringify([on, path])}`;
    this.expected = disk; this.value = disk ?? ''; this.saving = false; this.uncertain = false;
    this.unavailable = disk === null || disk.includes('\0');
    this.readonly = on ? 'Remote file · read-only' : disk === null ? 'File unavailable'
      : disk.includes('\0') ? 'Binary file · no text preview'
      : disk.length > EDIT_LIMIT ? 'Large file · read-only preview' : null;
    if (!on) {
      try {
        const draft = JSON.parse(storage.getItem(this.key) || 'null');
        if (typeof draft?.value === 'string' && typeof draft.expected === 'string'
          && (draft.value !== disk || typeof draft.pending === 'string')) {
          const pending = typeof draft.pending === 'string' ? draft.pending : null;
          // A stopped write may never have committed. Retry against the original snapshot
          // when it is still on disk, except for an undo to that very snapshot: an old
          // in-flight write could still replace it, so retain that backup conservatively.
          this.expected = pending !== null && (disk === pending || disk !== draft.expected || draft.value === disk)
            ? pending : draft.expected;
          this.uncertain = pending !== null && disk !== pending; this.recoveryPending = pending;
          this.value = draft.value; this.readonly = null; this.unavailable = false;
          this.notice = 'Recovered unsaved draft';
        }
      } catch { this.recoveryError = 'Draft recovery unavailable. The disk version is shown.'; }
    }
  }
  get dirty() { return !this.readonly && (this.value !== this.expected || this.saving || this.uncertain); }
  update(value, backup = true) { if (this.readonly) return; this.value = value; if (backup) this.persist(); }
  persist() {
    if (this.readonly) return;
    this.backupError = null;
    try {
      if (this.dirty) this.storage.setItem(this.key, JSON.stringify({ expected: this.expected, value: this.value,
        ...(this.saving ? { pending: this.pending } : this.uncertain ? { pending: this.recoveryPending } : {}) }));
      else this.storage.removeItem(this.key);
    } catch { this.backupError = 'Draft backup failed. Save before closing the app or reloading this mod.'; }
  }
  async save() {
    if (this.readonly || this.saving || !this.dirty) return;
    this.saving = true; this.error = null;
    const value = this.value, expected = this.expected;
    this.pending = value; this.persist();
    try {
      await this.write(this.path, value, expected);
      this.expected = value; this.uncertain = false; this.notice = 'Saved';
    } catch (e) {
      this.error = `Not saved: ${e.message ?? e}. Your draft is kept. If the file changed externally, copy your edits before reloading.`;
    } finally { this.saving = false; this.pending = undefined; this.persist(); }
  }
}
