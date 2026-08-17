// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteTitle } from "../note-title";

afterEach(cleanup);

const renameOk = () => vi.fn<(toPath: string) => Promise<void>>().mockResolvedValue(undefined);

describe("the editable H1", () => {
  // The server treats .md/.markdown/.mdx/.txt alike, so the title has to as
  // well: a private `.md`-only rule shows the other three their extension
  // inside the name the user edits, and renames them to `name.markdown.md`.
  it("hides the extension of EVERY doc the server indexes", () => {
    for (const [path, stem] of [
      ["notes/ideas.md", "ideas"],
      ["notes/spec.markdown", "spec"],
      ["notes/page.mdx", "page"],
      ["README.txt", "README"],
    ] as const) {
      const onRename = renameOk();
      render(<NoteTitle path={path} onRename={onRename} onSubmit={vi.fn()} />);
      const input = screen.getByLabelText("Note title");
      expect(input instanceof HTMLInputElement && input.value).toBe(stem);
      cleanup();
    }
  });

  it("renames a non-.md doc back onto its own extension", () => {
    const onRename = renameOk();
    render(<NoteTitle path="notes/spec.markdown" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "plans" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("notes/plans.markdown");
  });

  it("leaves a file that is not a doc showing its whole name", () => {
    const onRename = renameOk();
    render(<NoteTitle path="assets/logo.png" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    expect(input instanceof HTMLInputElement && input.value).toBe("logo.png");
    fireEvent.change(input, { target: { value: "mark.png" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("assets/mark.png");
  });

  it("shows the stem and renames on Enter", () => {
    const onRename = renameOk();
    const onSubmit = vi.fn();
    render(<NoteTitle path="notes/ideas.md" onRename={onRename} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Note title");
    expect(input instanceof HTMLInputElement && input.value).toBe("ideas");
    fireEvent.change(input, { target: { value: "plans" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("notes/plans.md");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renames on blur when the draft changed", () => {
    const onRename = renameOk();
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("Hello.md");
  });

  it("sends ONE rename when Enter's focus move fires the blur commit too", () => {
    const onRename = renameOk();
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("does not rename when the draft is unchanged", () => {
    const onRename = renameOk();
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText("Note title"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("Escape restores the stem without renaming", () => {
    const onRename = renameOk();
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "garbage" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(input instanceof HTMLInputElement && input.value).toBe("Welcome");
  });

  it("refuses an empty name silently and a bad name with the domain's reason", () => {
    const onRename = renameOk();
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "a/b" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "a:b" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "con" } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(input instanceof HTMLInputElement && input.value).toBe("Welcome");
  });

  it("allows retrying the same name after a failed rename", async () => {
    const onRename = vi
      .fn<(toPath: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("409"))
      .mockResolvedValue(undefined);
    render(<NoteTitle path="Welcome.md" onRename={onRename} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText("Note title");
    fireEvent.change(input, { target: { value: "Taken" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    // Same name again — the failure re-armed the guard.
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(2);
  });
});
