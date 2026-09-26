import { createRouterClient, implement, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { localContract } from "../../local-contract";
import { giveNoteOwnId } from "../give-note-own-id";
import { contentHashHex } from "../vault-schema";

const SHARED = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const SHARED_STORE = `.inteligir/comments/${SHARED}.json`;
const COPY = "Plan copy.md";
const COPY_BYTES = `---\ntitle: Plan\nid: ${SHARED}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;
const STORE_BYTES = '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n';
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

interface Refusal {
  path: string;
  error: ORPCError<string, unknown>;
}

interface VaultStub {
  disk: Map<string, string>;
  // every write and remove that landed, in order
  log: string[];
  // bytes another writer lands just before the next write to that path
  racing: { path: string; content: string } | null;
  refuseRead: Refusal | null;
  refuseWrite: Refusal | null;
}

const stubWith = (
  entries: Record<string, string>,
  faults: Partial<Pick<VaultStub, "racing" | "refuseRead" | "refuseWrite">> = {},
): VaultStub => ({
  disk: new Map(Object.entries(entries)),
  log: [],
  racing: null,
  refuseRead: null,
  refuseWrite: null,
  ...faults,
});

const os = implement(localContract);

// the contract's own procedures, so a refusal reaches the composition as the real client's would:
// a declared code arrives defined, anything else does not.
const vaultClient = (stub: VaultStub) =>
  createRouterClient({
    vault: {
      read: os.vault.read.handler(({ input, errors }) => {
        if (stub.refuseRead?.path === input.path) {
          throw stub.refuseRead.error;
        }
        const content = stub.disk.get(input.path);
        if (content === undefined) {
          throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
        }
        return { content, path: input.path };
      }),
      remove: os.vault.remove.handler(({ input, errors }) => {
        if (!stub.disk.delete(input.path)) {
          throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
        }
        stub.log.push(`remove ${input.path}`);
        return { ok: true } as const;
      }),
      write: os.vault.write.handler(async ({ input, errors }) => {
        if (stub.refuseWrite?.path === input.path) {
          throw stub.refuseWrite.error;
        }
        if (stub.racing?.path === input.path) {
          stub.disk.set(input.path, stub.racing.content);
          stub.racing = null;
        }
        const current = stub.disk.get(input.path);
        if (input.guard.kind === "absent" && current !== undefined) {
          throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
        }
        if (
          input.guard.kind === "expected" &&
          (current === undefined || (await contentHashHex(current)) !== input.guard.hash)
        ) {
          throw errors.CAS_MISMATCH({ data: {}, message: `${input.path} changed` });
        }
        stub.disk.set(input.path, input.content);
        stub.log.push(`write ${input.path}`);
        return { path: input.path };
      }),
    },
  });

const storeOf = (id: string): string => `.inteligir/comments/${id}.json`;

describe("giving a copy its own id", () => {
  it("copies the store under a new id first, then moves the copy's id line to it", async () => {
    const stub = stubWith({ [COPY]: COPY_BYTES, [SHARED_STORE]: STORE_BYTES });
    const result = await giveNoteOwnId(vaultClient(stub), COPY, SHARED);
    if (result.kind !== "done") {
      throw new Error(`expected done, got ${result.kind}`);
    }
    expect(result.id).toMatch(UUID_RE);
    expect(result.comments).toBe("copied");
    expect(stub.disk.get(COPY)).toBe(COPY_BYTES.replace(SHARED, result.id));
    expect(stub.disk.get(storeOf(result.id))).toBe(STORE_BYTES);
    expect(stub.disk.get(SHARED_STORE)).toBe(STORE_BYTES);
    expect(stub.log).toEqual([`write ${storeOf(result.id)}`, `write ${COPY}`]);
  });

  it("still gives a copy with no comments its own id", async () => {
    const stub = stubWith({ [COPY]: COPY_BYTES });
    const result = await giveNoteOwnId(vaultClient(stub), COPY, SHARED);
    expect(result.kind === "done" && result.comments).toBe("none");
    expect(stub.log).toEqual([`write ${COPY}`]);
  });

  it("writes nothing when the note no longer carries the id it was named with", async () => {
    const moved = COPY_BYTES.replace(SHARED, "already-its-own");
    const stub = stubWith({ [COPY]: moved, [SHARED_STORE]: STORE_BYTES });
    expect(await giveNoteOwnId(vaultClient(stub), COPY, SHARED)).toEqual({ kind: "changed" });
    expect(stub.log).toEqual([]);
    expect(stub.disk.get(COPY)).toBe(moved);
  });

  it("takes the new store back when the note changed under the write, and says so", async () => {
    const edited = `${COPY_BYTES}more\n`;
    const stub = stubWith(
      { [COPY]: COPY_BYTES, [SHARED_STORE]: STORE_BYTES },
      { racing: { content: edited, path: COPY } },
    );
    expect(await giveNoteOwnId(vaultClient(stub), COPY, SHARED)).toEqual({ kind: "changed" });
    expect(stub.disk.get(COPY)).toBe(edited);
    expect([...stub.disk.keys()].toSorted()).toEqual([COPY, SHARED_STORE].toSorted());
    expect(stub.log.at(-1)).toMatch(/^remove \.inteligir\/comments\//u);
  });

  it("refuses frontmatter it cannot read, writing nothing", async () => {
    const stub = stubWith({ [COPY]: `---\nid: ${SHARED}\n: [\n---\nbody\n` });
    expect(await giveNoteOwnId(vaultClient(stub), COPY, SHARED)).toEqual({ kind: "invalid" });
    expect(stub.log).toEqual([]);
  });

  it("reports a store it could not read or copy, leaving the note on the shared id", async () => {
    const unreadable = stubWith(
      { [COPY]: COPY_BYTES, [SHARED_STORE]: STORE_BYTES },
      {
        refuseRead: {
          error: new ORPCError("INTERNAL_SERVER_ERROR", { message: "EIO" }),
          path: SHARED_STORE,
        },
      },
    );
    const read = await giveNoteOwnId(vaultClient(unreadable), COPY, SHARED);
    expect(read.kind === "failed" && read.error.message).toBe("EIO");
    expect(unreadable.log).toEqual([]);
  });

  it("reports a note write refused for any reason but a change, still taking the store back", async () => {
    const stub = stubWith(
      { [COPY]: COPY_BYTES, [SHARED_STORE]: STORE_BYTES },
      {
        refuseWrite: {
          error: new ORPCError("INTERNAL_SERVER_ERROR", { message: "disk full" }),
          path: COPY,
        },
      },
    );
    const result = await giveNoteOwnId(vaultClient(stub), COPY, SHARED);
    expect(result.kind === "failed" && result.error.message).toBe("disk full");
    expect([...stub.disk.keys()].toSorted()).toEqual([COPY, SHARED_STORE].toSorted());
    expect(stub.disk.get(COPY)).toBe(COPY_BYTES);
  });
});
