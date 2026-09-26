// The rename's pure half, run by the server and the phone alike: the moves a rename makes, the old
// stem a renamed note keeps as an alias so any link the rewrite missed or skipped still resolves,
// and the writes the link rewrite lands. How those writes are guarded stays with each caller: the
// server moves the entry, then writes each doc only while it is unchanged; the phone queues the move
// and every write as one change set.

import { addFrontmatterAlias } from "../markdown/frontmatter";
import { docStem, isDocPath } from "./doc-file";

export interface RenameSource {
  kind: "file" | "dir";
  path: string;
}

// one move for a note, one per file under a folder
export const movesOf = (
  source: RenameSource,
  files: readonly string[],
  to: string,
): Map<string, string> => {
  if (source.kind === "file") {
    return new Map([[source.path, to]]);
  }
  const prefix = `${source.path}/`;
  return new Map(
    files
      .filter((file) => file.startsWith(prefix))
      .map((file): [string, string] => [file, `${to}/${file.slice(prefix.length)}`]),
  );
};

// a folder records none, since its moves keep every name, and neither does a case-only retitle:
// the old spelling still resolves through the case-insensitive tiers
export const renameAlias = (source: RenameSource, to: string): string | null => {
  if (source.kind !== "file" || !isDocPath(source.path) || !isDocPath(to)) {
    return null;
  }
  const oldStem = docStem(source.path);
  return oldStem === "" || oldStem.toLowerCase() === docStem(to).toLowerCase() ? null : oldStem;
};

export interface RenameWrite {
  // where the doc sits after the move
  path: string;
  // where it sat before, which is where its snapshot was read
  from: string;
  content: string;
  // the renamed note's own write, which carries the alias
  renamedNote: boolean;
}

interface RenameWritesInput {
  // `computeMoveEdits`' answer, keyed by post-move path
  edits: ReadonlyMap<string, string>;
  moves: ReadonlyMap<string, string>;
  // the renamed entry's post-move path
  renamed: string;
  alias: string | null;
}

// a renamed note whose own links needed no rewrite has no write here, and its caller records the
// alias on the note as it stands
export const renameWrites = ({
  edits,
  moves,
  renamed,
  alias,
}: RenameWritesInput): RenameWrite[] => {
  const movedFrom = new Map([...moves].map(([from, to]): [string, string] => [to, from]));
  return [...edits].map(([path, content]): RenameWrite => {
    const renamedNote = path === renamed;
    return {
      content:
        renamedNote && alias !== null ? (addFrontmatterAlias(content, alias) ?? content) : content,
      from: movedFrom.get(path) ?? path,
      path,
      renamedNote,
    };
  });
};
