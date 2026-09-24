import type { CreateOutcome, VaultIO, WriteOutcome } from "@repo/editor/vault-editor";

// `hangReads` never settles a read, so a runtime can be observed before its first
// load; `manualRead`/`manualWrite` park each call in pendingReads/pendingWrites until the test settles it;
// `landAs` makes a write land other bytes than it was sent, as a host's merge does, and
// `landsConflicted` says that merge overlapped. A write to a path with no file answers vanished,
// as a guarded write does; a remove takes a folder's files with it.
export class FakeVault implements VaultIO {
  files = new Map<string, string>();
  writes = 0;
  removes = 0;
  hangReads = false;
  manualRead = false;
  manualWrite = false;
  pendingReads: PromiseWithResolvers<string>[] = [];
  pendingWrites: PromiseWithResolvers<void>[] = [];
  landAs: ((sent: string) => string) | null = null;
  landsConflicted = false;

  read = async (path: string): Promise<string> => {
    if (this.hangReads) {
      return await Promise.withResolvers<string>().promise;
    }
    if (this.manualRead) {
      const pending = Promise.withResolvers<string>();
      this.pendingReads.push(pending);
      return await pending.promise;
    }
    const content = this.files.get(path);
    return content === undefined
      ? await Promise.reject(new Error("ENOENT"))
      : await Promise.resolve(content);
  };

  write = async (path: string, content: string): Promise<WriteOutcome> => {
    this.writes += 1;
    if (!this.files.has(path)) {
      return { kind: "vanished" };
    }
    const landed = this.landAs?.(content) ?? content;
    this.files.set(path, landed);
    if (this.manualWrite) {
      const pending: PromiseWithResolvers<void> = Promise.withResolvers();
      this.pendingWrites.push(pending);
      await pending.promise;
    }
    return { conflicted: this.landsConflicted, content: landed, kind: "landed" };
  };

  create = async (path: string, content: string): Promise<CreateOutcome> => {
    if (this.files.has(path)) {
      return await Promise.resolve({ kind: "exists" });
    }
    this.files.set(path, content);
    return await Promise.resolve({ kind: "created" });
  };

  remove = async (path: string): Promise<void> => {
    this.removes += 1;
    const gone = [...this.files.keys()].filter(
      (file) => file === path || file.startsWith(`${path}/`),
    );
    for (const file of gone) {
      this.files.delete(file);
    }
    await Promise.resolve();
  };
}
