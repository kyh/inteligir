// A note keeps the id it has. One without is minted one through a guarded write, re-read once if
// the note moved under it, because the user may be typing in it. Each caller decides what a
// refusal costs it: a comment is refused, an action keeps its path alone.

import { mintNoteId, withFrontmatterId } from "@repo/notes/markdown/frontmatter";
import type { VaultService } from "./vault-service";

export type EnsureNoteIdOutcome =
  | { kind: "id"; id: string }
  // the frontmatter is not valid YAML, so no id can be written into it
  | { kind: "invalid" }
  // the note's `id` is not text; a minted one would replace something another reader may resolve
  | { kind: "foreign-id"; value: string }
  // the note changed under the write twice
  | { kind: "changed" };

export const ensureNoteId = async (
  vault: Pick<VaultService, "read" | "writeIfUnchanged">,
  notePath: string,
  content: string,
): Promise<EnsureNoteIdOutcome> => {
  let current = content;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const id = mintNoteId();
    const verdict = withFrontmatterId(current, id);
    switch (verdict.kind) {
      case "unchanged": {
        return { id: verdict.id, kind: "id" };
      }
      case "invalid":
      case "foreign-id": {
        return verdict;
      }
      case "written": {
        const result = await vault.writeIfUnchanged(notePath, current, verdict.content);
        if (result.applied) {
          return { id, kind: "id" };
        }
        ({ content: current } = await vault.read(notePath));
        break;
      }
      // no default
    }
  }
  return { kind: "changed" };
};
