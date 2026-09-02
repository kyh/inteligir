import type { DeleteVaultEntryResult } from "@repo/editor/host-io";
import type { VaultIO } from "@repo/editor/vault-editor";

// `hangReads` never settles a read, so a runtime can be observed before its first
// load; `manualRead`/`manualWrite` park each call in pendingReads/pendingWrites until the test settles it.
export class FakeVault implements VaultIO {
  files = new Map<string, string>();
  writes = 0;
  removes = 0;
  hangReads = false;
  manualRead = false;
  manualWrite = false;
  pendingReads: PromiseWithResolvers<string>[] = [];
  pendingWrites: PromiseWithResolvers<void>[] = [];
  removeOutcome: DeleteVaultEntryResult = { outcome: "trashed" };

  read = (path: string): Promise<string> => {
    if (this.hangReads) return new Promise<string>(() => {});
    if (this.manualRead) {
      const pending = Promise.withResolvers<string>();
      this.pendingReads.push(pending);
      return pending.promise;
    }
    const content = this.files.get(path);
    return content === undefined ? Promise.reject(new Error("ENOENT")) : Promise.resolve(content);
  };

  write = (path: string, content: string): Promise<void> => {
    this.writes++;
    this.files.set(path, content);
    if (!this.manualWrite) return Promise.resolve();
    const pending = Promise.withResolvers<void>();
    this.pendingWrites.push(pending);
    return pending.promise;
  };

  remove = (path: string): Promise<DeleteVaultEntryResult> => {
    this.removes++;
    if (this.removeOutcome.outcome === "held") return Promise.resolve(this.removeOutcome);
    this.files.delete(path);
    return Promise.resolve(this.removeOutcome);
  };
}
