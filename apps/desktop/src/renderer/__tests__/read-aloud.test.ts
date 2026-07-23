// Read-aloud controller: chunking, the fail-closed privacy refusal (private +
// unparseable frontmatter + no provider registered), and the stop triggers
// (palette stop, note switch, voice-conversation start). The TTS client is
// mocked — playback is the tts.ts contract, exercised in the harness.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSlateEditor } from "platejs";

import { notePrivacy } from "@repo/notes/markdown/frontmatter";

type TtsHandleMock = {
  sendText: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const helpers = vi.hoisted(
  (): {
    ttsHandles: TtsHandleMock[];
    bridge: { isTtsAvailable: ReturnType<typeof vi.fn<() => Promise<boolean>>> };
  } => ({
    ttsHandles: [],
    bridge: { isTtsAvailable: vi.fn<() => Promise<boolean>>() },
  }),
);

vi.mock("@renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridge,
}));

vi.mock("@renderer/voice/tts", () => ({
  createTTS: vi.fn((): TtsHandleMock => {
    const handle: TtsHandleMock = {
      sendText: vi.fn(),
      flush: vi.fn(),
      interrupt: vi.fn(),
      close: vi.fn(),
    };
    helpers.ttsHandles.push(handle);
    return handle;
  }),
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  }),
}));

const { chunkForSpeech, editorPlainText, startReadAloud, stopReadAloud, useReadAloud } =
  await import("@renderer/voice/read-aloud");
const { useOpenNote } = await import("@renderer/workspace/open-note-store");
const { registerOpenNotePrivacy } = await import("@renderer/workspace/open-note-flush");
const { useVoiceStore } = await import("@renderer/stores/voice-store");
const { EDITOR_KIT } = await import("@renderer/editor/kits/editor-kit");
const { parseMarkdown } = await import("@renderer/editor/markdown/markdown-doc");

/** Publish an open markdown note (raw surface) into the open-note store. */
function setOpenMarkdown(path: string, content: string): void {
  useOpenNote.setState({
    openPath: path,
    editor: { root: "/vault", path, content, dirty: false, saving: false },
    openDoc: {
      kind: "markdown",
      path,
      isPrivate: notePrivacy(content) === "private",
      surface: { mode: "raw", reason: null },
    },
  });
}

/** Register the SAME privacy read VaultProvider wires: fail-closed over the
 * live buffer (indeterminate counts as private). */
function registerPrivacyOver(content: string): void {
  registerOpenNotePrivacy(() => notePrivacy(content) !== "public");
}

function closeNote(): void {
  useOpenNote.setState({
    openPath: null,
    editor: { root: "", path: null, content: "", dirty: false, saving: false },
    openDoc: { kind: "none" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  helpers.ttsHandles.length = 0;
  helpers.bridge.isTtsAvailable.mockResolvedValue(true);
});

afterEach(() => {
  stopReadAloud();
  registerOpenNotePrivacy(null);
  closeNote();
  useVoiceStore.setState({ state: { kind: "idle" } });
});

describe("chunkForSpeech", () => {
  it("emits one chunk per paragraph, collapsing intra-paragraph line breaks", () => {
    expect(chunkForSpeech("First line\ncontinues here.\n\nSecond paragraph.")).toEqual([
      "First line continues here.",
      "Second paragraph.",
    ]);
  });

  it("splits a long paragraph at sentence boundaries under the ceiling", () => {
    const sentence = `${"word ".repeat(8).trim()}.`;
    const paragraph = Array.from({ length: 6 }, () => sentence).join(" ");
    const chunks = chunkForSpeech(paragraph, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
      expect(chunk.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(paragraph);
  });

  it("hard-splits a single over-long sentence at the ceiling", () => {
    const run = "a".repeat(250);
    const chunks = chunkForSpeech(run, 100);
    expect(chunks).toEqual(["a".repeat(100), "a".repeat(100), "a".repeat(50)]);
  });

  it("returns nothing for whitespace-only text", () => {
    expect(chunkForSpeech("  \n\n \t ")).toEqual([]);
  });
});

describe("editorPlainText", () => {
  it("skips the frontmatter node and joins blocks with blank lines", () => {
    const parsed = parseMarkdown("---\ntitle: T\n---\n\n# Heading\n\nSome **bold** prose.\n");
    if (!parsed.ok) throw new Error("fixture must parse");
    const editor = createSlateEditor({ plugins: EDITOR_KIT, value: parsed.value });
    expect(editorPlainText(editor)).toBe("Heading\n\nSome bold prose.");
  });
});

describe("startReadAloud — privacy (fail-closed)", () => {
  it("refuses a `private: true` note", async () => {
    const content = "---\nprivate: true\n---\n\nSecret plans.\n";
    setOpenMarkdown("secret.md", content);
    registerPrivacyOver(content);

    await startReadAloud();

    expect(helpers.ttsHandles).toHaveLength(0);
    expect(useReadAloud.getState().active).toBe(false);
  });

  it("refuses unparseable frontmatter (indeterminate counts as private)", async () => {
    const content = "---\nfoo: [unclosed\n---\n\nBody text.\n";
    expect(notePrivacy(content)).toBe("indeterminate");
    setOpenMarkdown("broken.md", content);
    registerPrivacyOver(content);

    await startReadAloud();

    expect(helpers.ttsHandles).toHaveLength(0);
    expect(useReadAloud.getState().active).toBe(false);
  });

  it("refuses when no privacy provider is registered (fail-closed default)", async () => {
    setOpenMarkdown("plain.md", "Hello world.\n");
    // No registerOpenNotePrivacy call — the unregistered read must be private.

    await startReadAloud();

    expect(helpers.ttsHandles).toHaveLength(0);
    expect(useReadAloud.getState().active).toBe(false);
  });
});

describe("startReadAloud — availability", () => {
  it("refuses while TTS is unavailable", async () => {
    const content = "Hello world.\n";
    setOpenMarkdown("plain.md", content);
    registerPrivacyOver(content);
    helpers.bridge.isTtsAvailable.mockResolvedValue(false);

    await startReadAloud();

    expect(helpers.ttsHandles).toHaveLength(0);
    expect(useReadAloud.getState().active).toBe(false);
  });
});

describe("startReadAloud — session", () => {
  const content = "---\ntitle: Note\n---\n\nFirst paragraph.\n\nSecond paragraph.\n";

  function openPublicNote(): void {
    setOpenMarkdown("note.md", content);
    registerPrivacyOver(content);
  }

  it("chunks the note (frontmatter stripped) into ttsSend calls and flushes", async () => {
    openPublicNote();

    await startReadAloud();

    expect(useReadAloud.getState().active).toBe(true);
    const handle = helpers.ttsHandles[0];
    expect(handle?.sendText.mock.calls.map((call) => call[0])).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
    expect(handle?.flush).toHaveBeenCalledOnce();
  });

  it("stops (interrupt + close) when the open note switches", async () => {
    openPublicNote();
    await startReadAloud();
    const handle = helpers.ttsHandles[0];

    useOpenNote.setState({ openPath: "other.md" });

    expect(useReadAloud.getState().active).toBe(false);
    expect(handle?.interrupt).toHaveBeenCalledOnce();
    expect(handle?.close).toHaveBeenCalledOnce();
  });

  it("stops when the note vanishes (openPath cleared)", async () => {
    openPublicNote();
    await startReadAloud();

    closeNote();

    expect(useReadAloud.getState().active).toBe(false);
    expect(helpers.ttsHandles[0]?.interrupt).toHaveBeenCalledOnce();
  });

  it("stops when voice-conversation mode starts", async () => {
    openPublicNote();
    await startReadAloud();

    useVoiceStore.setState({ state: { kind: "connecting" } });

    expect(useReadAloud.getState().active).toBe(false);
    expect(helpers.ttsHandles[0]?.interrupt).toHaveBeenCalledOnce();
  });

  it("palette stop tears the session down", async () => {
    openPublicNote();
    await startReadAloud();

    stopReadAloud();

    expect(useReadAloud.getState().active).toBe(false);
    expect(helpers.ttsHandles[0]?.interrupt).toHaveBeenCalledOnce();
    expect(helpers.ttsHandles[0]?.close).toHaveBeenCalledOnce();
  });
});
