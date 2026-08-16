// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteTitle, noteStem, pathWithStem } from "../note-title";

afterEach(cleanup);

const renameOk = () => vi.fn<(toPath: string) => Promise<void>>().mockResolvedValue(undefined);

describe("path helpers", () => {
  it("extracts the stem of a markdown file", () => {
    expect(noteStem("notes/daily/2026-08-16.md")).toBe("2026-08-16");
    expect(noteStem("Welcome.md")).toBe("Welcome");
    expect(noteStem("data.txt")).toBe("data.txt");
  });

  it("rebuilds the path around a new stem", () => {
    expect(pathWithStem("notes/ideas.md", "plans")).toBe("notes/plans.md");
    expect(pathWithStem("Welcome.md", "Hello")).toBe("Hello.md");
    expect(pathWithStem("notes/data.txt", "renamed.txt")).toBe("notes/renamed.txt");
  });
});

describe("the editable H1", () => {
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
