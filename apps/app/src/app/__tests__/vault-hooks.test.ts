import type { VaultTreeResponse } from "@repo/server-contract/vault";
import { describe, expect, it } from "vitest";
import { filePathsLowercased, firstRootDoc, untitledNotePath } from "../vault-hooks";

const tree = (...paths: string[]): VaultTreeResponse => ({
  root: "/vault",
  entries: paths.map((path) =>
    path.endsWith("/")
      ? { kind: "dir" as const, path: path.slice(0, -1) }
      : { kind: "file" as const, path, size: 1 },
  ),
});

describe("the note a virgin boot opens", () => {
  // The whole bug: the server indexes and lists .txt/.markdown/.mdx as docs,
  // so a root holding only one of them has a note to open — a client that
  // knows only `.md` boots the vault to an empty pane.
  it("opens any doc the server would index, not just .md", () => {
    expect(firstRootDoc(tree("README.txt"))).toBe("README.txt");
    expect(firstRootDoc(tree("spec.markdown"))).toBe("spec.markdown");
    expect(firstRootDoc(tree("page.mdx"))).toBe("page.mdx");
  });

  it("skips folders, nested files and non-docs", () => {
    expect(firstRootDoc(tree("notes/", "notes/deep.md", "logo.png", "Welcome.md"))).toBe(
      "Welcome.md",
    );
    expect(firstRootDoc(tree("logo.png"))).toBeNull();
  });

  it("answers null while the listing has not arrived", () => {
    expect(firstRootDoc(undefined)).toBeNull();
  });
});

describe("naming a new note", () => {
  it("counts up until the folder has no such file", () => {
    const existing = filePathsLowercased(tree("Untitled.md", "notes/Untitled 2.md"));
    expect(untitledNotePath("", existing)).toBe("Untitled 2.md");
    expect(untitledNotePath("notes", existing)).toBe("notes/Untitled.md");
  });
});
