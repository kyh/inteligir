// The editor-side `private: true` read — derived LIVE from the document (the
// frontmatter node at [0]), not from any store or the saved file, so the
// instant the user types `private: true` (or flips the Page-details checkbox)
// every editor-AI surface stops BEFORE a save or index cycle runs. Shared by
// the ghost-text kit, the ⌘J session guards, and the palette toggle.

import type { SlateEditor } from "platejs";

import {
  parseProperties,
  serializeProperties,
  type TypedProperty,
} from "@repo/core/markdown/frontmatter";

import {
  readFrontmatterRaw,
  writeFrontmatterRaw,
} from "@renderer/editor/properties/properties-node";

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

/** Toggle the rich document's `private` checkbox through the frontmatter-node
 * seam — the SAME write path as the Page-details panel (Plate serialize →
 * editNote), never a second file writer. ON appends `private: true`; OFF
 * removes the key (an emptied block disappears). Returns false when the
 * frontmatter can't be typed: what we can't read, we never rewrite. */
export function toggleEditorNotePrivate(editor: SlateEditor): boolean {
  const raw = readFrontmatterRaw(editor) ?? "";
  const parsed = parseProperties(raw);
  if (parsed.kind === "invalid") return false;
  const props = (parsed.kind === "valid" ? parsed.properties : []).filter(
    (p) => p.key !== "private",
  );
  const next: TypedProperty[] = isEditorNotePrivate(editor)
    ? props
    : [...props, { key: "private", type: "checkbox", value: true }];
  writeFrontmatterRaw(editor, serializeProperties(next, raw));
  return true;
}
