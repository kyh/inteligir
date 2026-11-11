// An image in an item is a block the library holds (by its bytes' sha, or a web address). A file
// pasted or dropped into the text is kept in the library: the editor takes the event, so the
// browser neither opens the file nor drops it as text, has the host keep each file's bytes by
// their sha (`keepFile`) under the type the file came with, or plain bytes when the browser could
// not tell, and inserts the block that names it where the paste or the drop landed, a picture as
// an image, a recording as a video and anything else as a file, several in the order they came. A
// file past the library's size is refused in words, and nothing of it is read. Only the editor the
// file came into inserts its block, and only while its edits still reach the note: one that went
// read-only, or closed, while the bytes were kept says it could not add the file.

import { KEYS, PathApi } from "platejs";
import type { PathRef, SlateEditor, TElement, TRange } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { keptFileType } from "@repo/contract/items/item-kind";
import { toast } from "@repo/ui/components/sonner";

import { announceFileKeep } from "@repo/editor/file-keeps";
import { getEditorHostIo } from "@repo/editor/host-io";
import type { EditorHostIo } from "@repo/editor/host-io";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { editsReachNote } from "@repo/editor/live/yjs-binding";
import { ImageElement } from "@repo/editor/nodes/image-node";

const MB = 1024 * 1024;

export const fileTooLarge = (name: string, maxBytes: number): string =>
  `“${name}” is larger than ${String(Math.floor(maxBytes / MB))} MB, the most one file can be.`;

export const fileNotKept = (name: string): string =>
  `Couldn't add “${name}” to this note. Try again.`;

// what a paste's clipboard or a drop's drag hands over
interface Transfer {
  readonly files: Iterable<File>;
  readonly types: readonly string[];
}

// the files the editor keeps from a paste or a drop: the person's own, but not a browser's copy of
// a web picture, which also carries the page's own markup to paste
export const filesToKeep = (data: Transfer, from: "paste" | "drop"): File[] =>
  from === "paste" && data.types.includes("text/html") ? [] : [...data.files];

// the block a kept file is drawn by
const blockOf = (file: File, sha: string): TElement => {
  const children = [{ text: "" }];
  if (file.type.startsWith("image/")) {
    return { children, sha, type: KEYS.img };
  }
  if (file.type.startsWith("video/")) {
    return { children, sha, type: KEYS.video };
  }
  return { children, name: file.name === "" ? "File" : file.name, sha, type: KEYS.file };
};

// the file's bytes kept by the host, or null when they could not be read or kept
const keepOne = async (io: EditorHostIo, file: File): Promise<{ readonly sha: string } | null> => {
  try {
    return await io.keepFile(new Uint8Array(await file.arrayBuffer()), keptFileType(file.type));
  } catch {
    return null;
  }
};

// each file in turn, kept and then placed: the first where the paste or the drop landed, each
// later one right after the block placed before it, both followed as the text moves while the
// bytes are read, so the files keep their order and the caret rests past the last one
const placeFiles = async (
  editor: SlateEditor,
  files: readonly File[],
  at: TRange | null,
): Promise<void> => {
  const io = getEditorHostIo();
  const place = at === null ? null : editor.api.rangeRef(at);
  let last: PathRef | null = null;
  try {
    for (const file of files) {
      if (file.size > io.fileMaxBytes) {
        toast.error(fileTooLarge(file.name, io.fileMaxBytes));
        continue;
      }
      const kept = await keepOne(io, file);
      if (kept === null || !editsReachNote(editor)) {
        toast.error(fileNotKept(file.name));
        continue;
      }
      const previous = last?.current ?? null;
      const target = place?.current ?? null;
      if (previous === null && target !== null) {
        editor.tf.select(target);
      }
      const placed = insertVoidAndEscape(
        editor,
        blockOf(file, kept.sha),
        previous === null ? undefined : PathApi.next(previous),
      );
      last?.unref();
      last = placed === null ? null : editor.api.pathRef(placed);
    }
  } finally {
    place?.unref();
    last?.unref();
  }
};

const keepFiles = (editor: SlateEditor, files: readonly File[], at: TRange | null): void => {
  announceFileKeep(editor, placeFiles(editor, files, at));
};

// a separate plugin on the base half's key (headless/image-base.ts): DOM paste/drop handlers exist
// only on React plugins.
export const ImageKit = [
  createPlatePlugin({
    // the picture still draws read-only; only its paste and drop wait for an editable editor
    editOnly: { handlers: true, inject: false, render: false },
    key: KEYS.img,
    node: { isElement: true, isVoid: true },
  })
    .withComponent(ImageElement)
    .extend(() => ({
      handlers: {
        onDrop: ({ editor, event }) => {
          const files = filesToKeep(event.dataTransfer, "drop");
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          keepFiles(editor, files, editor.api.findEventRange(event) ?? editor.selection);
          return true;
        },
        onPaste: ({ editor, event }) => {
          const files = filesToKeep(event.clipboardData, "paste");
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          keepFiles(editor, files, editor.selection);
          return true;
        },
      },
    })),
];
