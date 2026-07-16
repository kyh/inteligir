// The editor-side `private: true` read — derived LIVE from the document (the
// frontmatter node at [0]), not from any store or the saved file, so the
// instant the user types `private: true` (or flips the Page-details checkbox)
// every editor-AI surface stops BEFORE a save or index cycle runs. Shared by
// the ghost-text kit, the ⌘J session guards, and the palette toggle.

import type { SlateEditor } from "platejs";

import { parseProperties } from "@repo/core/markdown/frontmatter";

import { readFrontmatterRaw } from "@renderer/editor/properties/properties-node";

/** Whether the open rich document is private for AI purposes. Fail-closed on
 * the AI side: frontmatter we can't type (`invalid`) reads TRUE — what we
 * can't read, we don't stream to a model. No frontmatter reads false. */
export function isEditorNotePrivate(editor: SlateEditor): boolean {
  const raw = readFrontmatterRaw(editor);
  if (raw === null) return false;
  const parsed = parseProperties(raw);
  if (parsed.kind === "none") return false;
  if (parsed.kind === "invalid") return true;
  const prop = parsed.properties.find((p) => p.key === "private");
  return prop !== undefined && prop.type === "checkbox" && prop.value;
}
