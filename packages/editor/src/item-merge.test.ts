import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { deferred } from "@repo/editor/deferred";
import type { Deferred } from "@repo/editor/deferred";
import { createGuardedVaultIo } from "@repo/editor/guarded-vault-io";
import type {
  GuardedVaultPort,
  GuardedWrite,
  GuardedWriteResult,
} from "@repo/editor/guarded-vault-io";
import { VaultEditorController } from "@repo/editor/vault-editor";
import { composeLinkBody } from "@repo/notes/items/item-body";
import { composeItemFile } from "@repo/notes/items/item-frontmatter";
import type { ItemFileFields } from "@repo/notes/items/item-frontmatter";
import { diff3 } from "@repo/notes/text/diff3";
import { FakeVault } from "./test-support/fake-vault";

const ITEM = "Unsorted/File over app.md";

const fill = (fetched: string, cover: string, extra: ItemFileFields = {}): string =>
  composeItemFile(
    {
      description: "Files you can control.",
      fetched,
      id: "7d2f9e40-1c6b-4a8e-9f31-5b0a6c2e8d17",
      kind: "link",
      saved: "2026-10-17T09:12:30Z",
      site: "Steph Ango",
      url: "https://stephango.com/file-over-app",
      ...extra,
    },
    composeLinkBody({
      article: "File over app is a philosophy.",
      copy: null,
      cover,
      note: "For Tuesday.",
    }),
  );

const LOADED = fill("2026-10-17T09:12:33Z", "assets/covers/3f9a0c2b1d4e5f60.jpg");
// Refresh from the page, with the text kept: a new mark, a new cover and a new summary
const REFRESHED = fill("2026-10-18T08:00:00Z", "assets/covers/9c1d0a7b6e5f4c3d.jpg", {
  description: "A newer summary.",
});
const TYPED = "\nMy own thoughts, typed after pressing Refresh.\n";
const MORE = "\nAnd one more line, typed while that save was out.\n";

// the host's CAS, whose second write (the 409's retry) waits until the test lets it go
class GatedStore implements GuardedVaultPort {
  readonly files: Map<string, string>;
  readonly guards: GuardedWrite[] = [];
  retryGate: Deferred<void> | null = null;

  constructor(seed: Readonly<Record<string, string>>) {
    this.files = new Map(Object.entries(seed));
  }

  read = async (path: string): Promise<string> => {
    const content = this.files.get(path);
    return content === undefined ? await Promise.reject(new Error("ENOENT")) : content;
  };

  write = async (
    path: string,
    content: string,
    guard: GuardedWrite,
  ): Promise<GuardedWriteResult> => {
    this.guards.push(guard);
    if (this.guards.length === 2 && this.retryGate !== null) {
      await this.retryGate.promise;
    }
    const current = this.files.get(path);
    if (current === undefined) {
      return { kind: guard.kind === "absent" ? "written" : "missing" };
    }
    if (guard.kind === "absent") {
      return { kind: "exists" };
    }
    if (current !== guard.base) {
      return { current, kind: "changed" };
    }
    this.files.set(path, content);
    return { kind: "written" };
  };

  remove = async (path: string): Promise<void> => {
    this.files.delete(path);
  };
}

describe("an open item's saves over a refresh of its page", () => {
  it("lands the refresh's keys and the person's typing on the 409's retry, with no overlap said", async () => {
    const store = new GatedStore({ [ITEM]: LOADED });
    let conflicts = 0;
    const controller = new VaultEditorController(createGuardedVaultIo(store), undefined, () => {
      conflicts += 1;
    });
    await controller.open(ITEM);
    store.files.set(ITEM, REFRESHED);

    controller.edit(`${LOADED}${TYPED}`);
    await controller.flush();

    expect(store.guards).toStrictEqual([
      { base: LOADED, kind: "expected" },
      { base: REFRESHED, kind: "expected" },
    ]);
    expect(store.files.get(ITEM)).toBe(`${REFRESHED}${TYPED}`);
    expect(controller.getState()).toMatchObject({ content: `${REFRESHED}${TYPED}`, dirty: false });
    expect(conflicts).toBe(0);
  });

  it("keeps the refresh's keys through the rebase of what was typed while the retry was out", async () => {
    const store = new GatedStore({ [ITEM]: LOADED });
    store.retryGate = deferred();
    let conflicts = 0;
    const controller = new VaultEditorController(createGuardedVaultIo(store), undefined, () => {
      conflicts += 1;
    });
    await controller.open(ITEM);
    store.files.set(ITEM, REFRESHED);

    controller.edit(`${LOADED}${TYPED}`);
    const saving = controller.flush();
    await delay(0);
    controller.edit(`${LOADED}${TYPED}${MORE}`);
    store.retryGate.resolve();
    await saving;

    expect(controller.getState()).toMatchObject({
      content: `${REFRESHED}${TYPED}${MORE}`,
      dirty: true,
    });
    await controller.flush();
    expect(store.files.get(ITEM)).toBe(`${REFRESHED}${TYPED}${MORE}`);
    expect(conflicts).toBe(0);
  });

  it("takes the refresh's summary over the line merge's overlap, where diff3 would keep the buffer's", async () => {
    const io = new FakeVault();
    io.files.set(ITEM, LOADED);
    io.manualWrite = true;
    // the host merged the refresh in under the typing it was sent
    io.landAs = (sent) => sent.replace(LOADED, REFRESHED);
    let conflicts = 0;
    const controller = new VaultEditorController(io, undefined, () => {
      conflicts += 1;
    });
    await controller.open(ITEM);
    controller.edit(`${LOADED}${TYPED}`);
    const saving = controller.flush();
    await delay(0);
    const described = `${LOADED.replace("Files you can control.", "Mine, in my words.")}${TYPED}`;
    controller.edit(described);
    io.pendingWrites[0]?.resolve();
    await saving;

    expect(diff3(`${LOADED}${TYPED}`, described, `${REFRESHED}${TYPED}`).conflicted).toBe(true);
    expect(controller.getState()).toMatchObject({ content: `${REFRESHED}${TYPED}`, dirty: false });
    expect(conflicts).toBe(0);
  });

  it("is diff3 for a note", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    io.manualWrite = true;
    io.landAs = (sent) => `${sent}external\n`;
    const controller = new VaultEditorController(io);
    await controller.open("a.md");
    controller.edit("one typed\ntwo\nthree\n");
    const saving = controller.flush();
    await delay(0);
    controller.edit("one typed more\ntwo\nthree\n");
    io.pendingWrites[0]?.resolve();
    await saving;
    expect(controller.getState()).toMatchObject({
      content: "one typed more\ntwo\nthree\nexternal\n",
    });
  });
});
