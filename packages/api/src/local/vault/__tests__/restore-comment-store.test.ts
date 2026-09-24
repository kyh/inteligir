import { createRouterClient, implement, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { localContract } from "../../local-contract";
import { restoreCommentStore } from "../restore-comment-store";

const SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const STORE = `.inteligir/comments/${NOTE_ID}.json`;
const NOTE = `---\nid: ${NOTE_ID}\n---\n# Kept\n`;
const STORE_BYTES = '{"threads":[]}\n';

interface VaultStub {
  // what each path held at SHA
  history: Map<string, string>;
  disk: Map<string, string>;
  refuseRevision?: ORPCError<string, unknown>;
  refuseWrite?: ORPCError<string, unknown>;
}

const os = implement(localContract);

// the contract's own procedures, so a refusal reaches the composition as the real client's would:
// a declared code arrives defined, anything else does not.
const vaultClient = (stub: VaultStub) =>
  createRouterClient({
    vault: {
      revision: os.vault.revision.handler(({ input, errors }) => {
        if (stub.refuseRevision !== undefined) {
          throw stub.refuseRevision;
        }
        const content = input.sha === SHA ? stub.history.get(input.path) : undefined;
        if (content === undefined) {
          throw errors.NOT_FOUND({ message: `${input.path} does not exist at ${input.sha}` });
        }
        return { content };
      }),
      write: os.vault.write.handler(({ input, errors }) => {
        if (stub.refuseWrite !== undefined) {
          throw stub.refuseWrite;
        }
        if (input.guard.kind === "absent" && stub.disk.has(input.path)) {
          throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
        }
        stub.disk.set(input.path, input.content);
        return { path: input.path };
      }),
    },
  });

describe("bringing a deleted note's comment store back", () => {
  it("restores the store the note held at that revision", async () => {
    const stub: VaultStub = { disk: new Map(), history: new Map([[STORE, STORE_BYTES]]) };
    expect(await restoreCommentStore(vaultClient(stub), NOTE, SHA)).toEqual({ kind: "restored" });
    expect(stub.disk.get(STORE)).toBe(STORE_BYTES);
  });

  it("keeps a store already at that id, and it wins", async () => {
    const stub: VaultStub = {
      disk: new Map([[STORE, "{}\n"]]),
      history: new Map([[STORE, STORE_BYTES]]),
    };
    expect(await restoreCommentStore(vaultClient(stub), NOTE, SHA)).toEqual({ kind: "kept" });
    expect(stub.disk.get(STORE)).toBe("{}\n");
  });

  it("has none for a note without an id, or with no store at that revision", async () => {
    const stub: VaultStub = { disk: new Map(), history: new Map([[STORE, STORE_BYTES]]) };
    expect(await restoreCommentStore(vaultClient(stub), "# No id\n", SHA)).toEqual({
      kind: "none",
    });
    stub.history.clear();
    expect(await restoreCommentStore(vaultClient(stub), NOTE, SHA)).toEqual({ kind: "none" });
    expect(stub.disk.size).toBe(0);
  });

  it("reports a revision read that failed, never calling it none", async () => {
    const stub: VaultStub = {
      disk: new Map(),
      history: new Map([[STORE, STORE_BYTES]]),
      refuseRevision: new ORPCError("INTERNAL_SERVER_ERROR", { message: "git show failed" }),
    };
    const result = await restoreCommentStore(vaultClient(stub), NOTE, SHA);
    expect(result.kind === "failed" && result.error.message).toBe("git show failed");
    expect(stub.disk.size).toBe(0);
  });

  it("reports a write refused for any reason but the create's, never calling it kept", async () => {
    const stub: VaultStub = {
      disk: new Map(),
      history: new Map([[STORE, STORE_BYTES]]),
      refuseWrite: new ORPCError("CONFLICT", {
        message: `A file shadows a parent folder of ${STORE}`,
      }),
    };
    const result = await restoreCommentStore(vaultClient(stub), NOTE, SHA);
    expect(result.kind === "failed" && result.error.message).toBe(
      `A file shadows a parent folder of ${STORE}`,
    );
  });
});
