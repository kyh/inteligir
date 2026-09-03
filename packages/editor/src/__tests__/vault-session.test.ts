import type { VaultEntry } from "@repo/editor/host-io";
import { describe, expect, it } from "vitest";
import { createVaultSession, type VaultSessionPorts } from "@repo/editor/note/vault-session";

type NoteCall = readonly ["create" | "write", string, string];

function sessionOver(options: { exists: boolean; createRefuses?: boolean }) {
  const noteCalls: NoteCall[] = [];
  const notices: string[] = [];
  const entries: VaultEntry[] = [];
  const ports: VaultSessionPorts = {
    boot: () => Promise.resolve({ root: "/vault", entries, openNote: null }),
    list: () => Promise.resolve(entries),
    refresh: () => Promise.resolve(),
    exists: () => Promise.resolve(options.exists),
    rename: () => Promise.resolve({ ok: true }),
    note: {
      read: () => Promise.resolve(""),
      write: (path, content) => {
        noteCalls.push(["write", path, content]);
        return Promise.resolve();
      },
      create: (path, content) => {
        noteCalls.push(["create", path, content]);
        return options.createRefuses === true
          ? Promise.reject(new Error("A file already exists at Fresh.md"))
          : Promise.resolve();
      },
      remove: () => Promise.resolve({ outcome: "removed" }),
    },
    publishListing: () => {},
    publishRoot: () => {},
    publishOpenPath: () => {},
    publishEditor: () => {},
    showEditor: () => {},
    notify: (_level, message) => {
      notices.push(message);
    },
  };
  return { session: createVaultSession(ports), noteCalls, notices };
}

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
    const { session, notices } = sessionOver({ exists: false, createRefuses: true });
    await expect(session.actions.createFileAt("Fresh")).resolves.toBeNull();
    expect(notices).toEqual(["Couldn't create Fresh.md."]);
  });
});
