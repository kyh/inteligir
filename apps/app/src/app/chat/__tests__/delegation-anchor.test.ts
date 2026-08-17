// The anchor persists through the note's NORMAL save pipeline, twice over:
// the NoteController carries a marker splice to its guarded save with the
// pre-insert base, and the real vault CAS accepts that write byte-exactly —
// no bespoke marker write path exists to drift from either.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { insertThreadMarker, threadMarkerText } from "@repo/notes/markdown/thread-marker";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentHashHex } from "../../note/content-hash";
import { NoteController, type NoteBuffer, type SaveResult } from "../../note/note-controller";
import { bootChatHarness } from "./chat-harness";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

const DOC = `# Plans

First paragraph.
`;

function fakeBuffer(initial: string): NoteBuffer & { content: string } {
  return {
    content: initial,
    getDoc() {
      return this.content;
    },
    replaceDoc(next: string) {
      this.content = next;
    },
  };
}

describe("anchor insertion through the save pipeline", () => {
  it("the controller saves the spliced marker against the pre-insert base", async () => {
    const buffer = fakeBuffer(DOC);
    const saves: Array<{ content: string; base: string }> = [];
    const save = (content: string, base: string): Promise<SaveResult> => {
      saves.push({ content, base });
      return Promise.resolve({ ok: true });
    };
    const controller = new NoteController({
      buffer,
      initialContent: DOC,
      save,
      onConflict: () => {},
      onSaveError: () => {},
    });

    buffer.content = insertThreadMarker(DOC, DOC.indexOf("paragraph"), "anc_ctrl");
    controller.docChanged();
    await controller.flush();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.base).toBe(DOC);
    expect(saves[0]?.content).toBe(`# Plans

First paragraph.
${threadMarkerText("anc_ctrl")}
`);
    expect(controller.isDirty()).toBe(false);
    controller.dispose();
  });

  it("the real vault CAS accepts the marker write and the bytes land on disk", async () => {
    const { client, vaultDir } = await bootChatHarness({ mode: "manual" }, cleanups);
    const path = "Notes/Plans.md";
    const put = await client.vault.file.$put({ json: { path, content: DOC, ifAbsent: true } });
    expect(put.status).toBe(200);

    const withMarker = insertThreadMarker(DOC, DOC.indexOf("paragraph"), "anc_cas");
    const guarded = await client.vault.file.$put({
      json: { path, content: withMarker, expectedHash: await contentHashHex(DOC) },
    });
    expect(guarded.status).toBe(200);
    expect(await readFile(join(vaultDir, path), "utf8")).toBe(withMarker);

    // A stale base is refused, marker or not — the guard still guards.
    const stale = await client.vault.file.$put({
      json: { path, content: DOC, expectedHash: await contentHashHex(DOC) },
    });
    expect(stale.status).toBe(409);
    expect(await readFile(join(vaultDir, path), "utf8")).toBe(withMarker);
  });
});
