import type { VaultEntry } from "@repo/editor/host-io";
import { describe, expect, it } from "vitest";
import { createVaultSession } from "@repo/editor/note/vault-session";
import type { VaultSessionPorts } from "@repo/editor/note/vault-session";

type NoteCall = readonly ["create" | "write", string, string];

const sessionOver = (options: { exists: boolean; createRefuses?: boolean }) => {
  const noteCalls: NoteCall[] = [];
  const notices: string[] = [];
  const entries: VaultEntry[] = [];
  const ports: VaultSessionPorts = {
    // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
    boot: async () => ({ entries, openNote: null, root: "/vault" }),
    // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
    exists: async () => options.exists,
    // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
    list: async () => entries,
    note: {
      create: async (path, content) => {
        noteCalls.push(["create", path, content]);
        await Promise.resolve();
        if (options.createRefuses === true) {
          throw new Error("A file already exists at Fresh.md");
        }
      },
      // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
      read: async () => "",
      // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
      remove: async () => ({ outcome: "removed" }),
      // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
      write: async (path, content) => {
        noteCalls.push(["write", path, content]);
      },
    },
    notify: (_level, message) => {
      notices.push(message);
    },
    publishEditor: () => {},
    publishListing: () => {},
    publishOpenPath: () => {},
    publishRoot: () => {},
    refresh: async () => {},
    // oxlint-disable-next-line require-await -- the contract is a promise; nothing here waits.
    rename: async () => ({ ok: true }),
    showEditor: () => {},
  };
  return { noteCalls, notices, session: createVaultSession(ports) };
};

describe("createFileAt", () => {
  it("creates a genuinely new note through the port's create, never its write", async () => {
    const { session, noteCalls, notices } = sessionOver({ exists: false });
    await expect(session.actions.createFileAt("Fresh", "# Fresh\n")).resolves.toBe("Fresh.md");
    expect(noteCalls).toEqual([["create", "Fresh.md", "# Fresh\n"]]);
    expect(notices).toEqual([]);
  });

  it("opens a note that already exists without writing anything", async () => {
    const { session, noteCalls } = sessionOver({ exists: true });
    await expect(session.actions.createFileAt("Fresh", "# Fresh\n")).resolves.toBe("Fresh.md");
    expect(noteCalls).toEqual([]);
  });

  it("reports a refused create instead of opening a note that was not made", async () => {
    const { session, notices } = sessionOver({ createRefuses: true, exists: false });
    await expect(session.actions.createFileAt("Fresh")).resolves.toBeNull();
    expect(notices).toEqual(["Couldn't create Fresh.md."]);
  });
});
