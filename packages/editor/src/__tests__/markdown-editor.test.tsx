import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@repo/editor/markdown-editor";

const mocks = vi.hoisted(() => ({
  currentMarkdown: "seed",
  editor: {
    operations: [{ type: "insert_text" }],
    tf: {
      setValue: vi.fn((value: { children: { text: string }[] }[]) => {
        mocks.currentMarkdown = value[0]?.children[0]?.text ?? "";
      }),
    },
  },
}));

vi.mock("platejs/react", () => ({
  Plate: ({ children, onChange }: { children?: React.ReactNode; onChange?: () => void }) => (
    <div>
      <button type="button" onClick={onChange}>
        change
      </button>
      {children}
    </div>
  ),
  useEditorRef: () => mocks.editor,
  usePlateEditor: () => mocks.editor,
}));

vi.mock("@platejs/markdown", () => ({
  serializeMd: vi.fn(() => mocks.currentMarkdown),
}));

vi.mock("@repo/editor/editor-chrome", () => ({
  Editor: () => null,
  EditorContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@repo/editor/live-editor", () => ({
  registerLiveEditor: vi.fn(() => () => {}),
}));

vi.mock("@repo/editor/note-stats", () => ({
  clearNoteStats: vi.fn(),
  collectNoteStats: vi.fn(() => ({ characters: 0, words: 0 })),
  publishNoteStats: vi.fn(),
}));

vi.mock("@repo/editor/kits/block-placeholder-kit", () => ({
  WRITE_PLACEHOLDER: "Write something…",
}));

vi.mock("@repo/editor/kits/editor-kit", () => ({
  EDITOR_KIT: [],
}));

vi.mock("@repo/editor/markdown/markdown-doc", () => ({
  MD_STRINGIFY: {},
  parseMarkdown: (markdown: string) => ({
    ok: true,
    value: [{ children: [{ text: markdown }], type: "p" }],
  }),
}));

vi.mock("@repo/editor/toc", () => ({
  TableOfContents: () => null,
}));

const DELAY_MS = 150;

const props = (overrides?: {
  onChange?: (markdown: string) => void;
  onRegisterSerializeFlush?: (flush: () => void) => void;
  onSettled?: (markdown: string) => void;
  value?: string;
}) => {
  const base = {
    onChange: overrides?.onChange ?? vi.fn(),
    onSettled: overrides?.onSettled ?? vi.fn(),
    path: "note.md",
    value: overrides?.value ?? "seed",
  };
  return overrides?.onRegisterSerializeFlush === undefined
    ? base
    : { ...base, onRegisterSerializeFlush: overrides.onRegisterSerializeFlush };
};

describe("MarkdownEditor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.currentMarkdown = "seed";
    mocks.editor.operations = [{ type: "insert_text" }];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("drops the normalized seed echo", () => {
    const onChange = vi.fn<(markdown: string) => void>();
    const view = render(<MarkdownEditor {...props({ onChange })} />);

    fireEvent.click(view.getByRole("button", { name: "change" }));
    void act(() => vi.advanceTimersByTime(DELAY_MS));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes a pending debounce to the latest committed callback", () => {
    const first = vi.fn<(markdown: string) => void>();
    const second = vi.fn<(markdown: string) => void>();
    const view = render(<MarkdownEditor {...props({ onChange: first })} />);
    mocks.currentMarkdown = "edited";
    fireEvent.click(view.getByRole("button", { name: "change" }));

    view.rerender(<MarkdownEditor {...props({ onChange: second })} />);
    void act(() => vi.advanceTimersByTime(DELAY_MS));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith("edited");
  });

  it("flushes a pending edit before an external reseed", () => {
    const onChange = vi.fn<(markdown: string) => void>();
    const view = render(<MarkdownEditor {...props({ onChange })} />);
    mocks.currentMarkdown = "edited";
    fireEvent.click(view.getByRole("button", { name: "change" }));

    view.rerender(<MarkdownEditor {...props({ onChange, value: "external" })} />);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("edited");
    expect(mocks.currentMarkdown).toBe("external");
    void act(() => vi.advanceTimersByTime(DELAY_MS));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("registers a synchronous serialize flush", () => {
    const onChange = vi.fn<(markdown: string) => void>();
    let flush: (() => void) | undefined;
    const register = vi.fn((next: () => void) => {
      flush = next;
    });
    const view = render(
      <MarkdownEditor {...props({ onChange, onRegisterSerializeFlush: register })} />,
    );
    mocks.currentMarkdown = "edited";
    fireEvent.click(view.getByRole("button", { name: "change" }));

    expect(register).toHaveBeenCalledOnce();
    if (flush === undefined) {
      throw new Error("serialize flush was not registered");
    }
    flush();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("edited");
    void act(() => vi.advanceTimersByTime(DELAY_MS));
    expect(onChange).toHaveBeenCalledOnce();
  });
});
