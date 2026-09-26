import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getLiveEditor } from "@repo/editor/live-editor";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";

import { connectPageBridge } from "../bridge/page-bridge";
import type { PageInit } from "../bridge/protocol";
import { EditorPage, mountEditorPage } from "../editor-page";
import type { MountedPage } from "../editor-page";
import { createFakePhone, PHONE_NONCE } from "./fake-phone";

const NOTE = "# Note\n\nHello there.\n";

let mounted: MountedPage | null = null;

afterEach(() => {
  act(() => {
    mounted?.unmount();
  });
  mounted = null;
});

const ONE_NOTE = { "Note.md": NOTE };

const mount = async (
  overrides: Partial<PageInit> = {},
  files: Readonly<Record<string, string>> = ONE_NOTE,
) => {
  const phone = createFakePhone(files);
  const connecting = connectPageBridge(phone.transport);
  phone.init(overrides);
  const { bridge, init } = await connecting;
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    mounted = mountEditorPage({ bridge, container, init });
  });
  const editor = await waitFor(() => {
    const live = getLiveEditor("Note.md");
    if (live === null) {
      throw new Error("the note's editor has not mounted");
    }
    return live;
  });
  return { editor, phone };
};

describe("the phone editor page", () => {
  it("sends the phone exactly the bytes the editor serializes for a typed paragraph", async () => {
    const { editor, phone } = await mount();

    act(() => {
      editor.tf.select(editor.api.end([1]));
      editor.tf.insertText(" Typed on the phone.");
    });

    const write = await waitFor(() => {
      const [landed] = phone.requests("write");
      if (landed === undefined) {
        throw new Error("no write reached the phone");
      }
      return landed;
    });
    expect(write.payload.content).toBe(serializeNote(editor));
    expect(write.payload.content).toBe("# Note\n\nHello there. Typed on the phone.\n");
    expect(write.payload.guard).toEqual({ base: NOTE, kind: "expected" });
    expect(write.nonce).toBe(PHONE_NONCE);
  });

  it("takes a thread the phone deleted out of the note, and writes the note without it", async () => {
    const anchored = "# Note\n\n%%i:c1:start%%Hello%%i:c1:end%% there.\n";
    const { phone } = await mount({}, { "Note.md": anchored });

    act(() => {
      phone.deliver({ ids: ["c1"], nonce: PHONE_NONCE, type: "commentsRemoved" });
    });

    await waitFor(() => {
      expect(phone.files.get("Note.md")).toBe(NOTE);
    });
    expect(phone.requests("write").at(-1)?.payload.guard).toEqual({
      base: anchored,
      kind: "expected",
    });
  });

  it("draws the touch hand: the keyboard toolbar, and the body focused when init asks", async () => {
    await mount({ focus: "body" });
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    await waitFor(() => {
      const body = document.querySelector('[data-slate-editor="true"]');
      expect(body).not.toBeNull();
      expect(document.activeElement).toBe(body);
    });
  });
});

// a component the compiler memoizes wrongly passes every other test and fails only on the phone
it("holds the React Compiler's output for the page's components", () => {
  expect(
    EditorPage.toString(),
    "the mobile-editor vitest project must run @vitejs/plugin-react with the compiler over src/",
  ).toContain("react.memo_cache_sentinel");
});
