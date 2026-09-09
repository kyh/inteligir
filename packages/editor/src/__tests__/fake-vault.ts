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
  removeOutcome: DeleteVaultEntryResult = { outcome: "removed" };

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

  write = async (path: string, content: string): Promise<void> => {
    this.writes += 1;
    this.files.set(path, content);
    if (!this.manualWrite) {
      return;
    }
    const pending: PromiseWithResolvers<void> = Promise.withResolvers();
    this.pendingWrites.push(pending);
    await pending.promise;
  };

  create = async (path: string, content: string): Promise<void> => {
    if (this.files.has(path)) {
      throw new Error("EEXIST");
    }
    this.files.set(path, content);
    await Promise.resolve();
  };

  remove = async (path: string): Promise<DeleteVaultEntryResult> => {
    this.removes += 1;
    if (this.removeOutcome.outcome !== "held") {
      this.files.delete(path);
    }
    return await Promise.resolve(this.removeOutcome);
  };
}
