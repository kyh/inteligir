import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownEditor } from "@repo/editor/markdown-editor";

const mocks = vi.hoisted(() => ({
  currentMarkdown: "seed",
  hasSuggestions: false,
  settledMarkdown: "settled",
  editor: {
    operations: [{ type: "insert_text" }],
    tf: {
      setValue: vi.fn((value: Array<{ children: Array<{ text: string }> }>) => {
        mocks.currentMarkdown = value[0]?.children[0]?.text ?? "";
      }),
    },
  },
  releaseAiSession: vi.fn(),
  resolveAllSuggestions: vi.fn(() => {
    mocks.currentMarkdown = mocks.settledMarkdown;
    mocks.hasSuggestions = false;
  }),
  setReviewing: vi.fn(),
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
  usePlateEditor: () => mocks.editor,
}));

vi.mock("@platejs/markdown", () => ({
  serializeMd: vi.fn(() => mocks.currentMarkdown),
}));

vi.mock("@repo/editor/ai/ai-session", () => ({
  releaseAiSession: mocks.releaseAiSession,
}));

vi.mock("@repo/editor/ai/suggestions", () => ({
  hasTransientSuggestions: () => mocks.hasSuggestions,
  resolveAllSuggestions: mocks.resolveAllSuggestions,
}));

vi.mock("@repo/editor/ai/transient", () => ({
  hasTransientAiState: () => false,
}));

vi.mock("@repo/editor/ai/transient-settle", () => ({
  registerTransientSettler: vi.fn(() => () => {}),
}));

vi.mock("@repo/editor/editor-chrome", () => ({
  Editor: () => null,
  EditorContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@repo/editor/live-editor", () => ({
  registerLiveEditor: vi.fn(() => () => {}),
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

vi.mock("@repo/editor/stores/ai-review-store", () => ({
  useAiReviewStore: {
    getState: () => ({ setReviewing: mocks.setReviewing }),
  },
}));

const DELAY_MS = 150;

function props(overrides?: {
  onChange?: (markdown: string) => void;
  onRegisterSerializeFlush?: (flush: () => void) => void;
  onSettled?: (markdown: string) => void;
  value?: string;
}) {
  const base = {
    path: "note.md",
    value: overrides?.value ?? "seed",
    onChange: overrides?.onChange ?? vi.fn(),
    onSettled: overrides?.onSettled ?? vi.fn(),
  };
  return overrides?.onRegisterSerializeFlush === undefined
    ? base
    : { ...base, onRegisterSerializeFlush: overrides.onRegisterSerializeFlush };
}

describe("MarkdownEditor lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.currentMarkdown = "seed";
    mocks.hasSuggestions = false;
    mocks.settledMarkdown = "settled";
    mocks.editor.operations = [{ type: "insert_text" }];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("drops the normalized seed echo", () => {
    const onChange = vi.fn();
    const view = render(<MarkdownEditor {...props({ onChange })} />);

    fireEvent.click(view.getByRole("button", { name: "change" }));
    void act(() => vi.advanceTimersByTime(DELAY_MS));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes a pending debounce to the latest committed callback", () => {
    const first = vi.fn();
    const second = vi.fn();
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
    const onChange = vi.fn();
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
    const onChange = vi.fn();
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
    if (flush === undefined) throw new Error("serialize flush was not registered");
    flush();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("edited");
    void act(() => vi.advanceTimersByTime(DELAY_MS));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("settles through the latest committed teardown callback once", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(<MarkdownEditor {...props({ onSettled: first })} />);
    view.rerender(<MarkdownEditor {...props({ onSettled: second })} />);
    mocks.hasSuggestions = true;

    view.unmount();

    expect(mocks.resolveAllSuggestions).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith("settled");
    expect(mocks.releaseAiSession).toHaveBeenCalledOnce();
  });
});
