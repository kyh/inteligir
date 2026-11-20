import { KEYS, PathApi } from "platejs";
import type { PathRef, SlateEditor, TElement, TRange } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { keptFileType } from "@repo/contract/items/item-kind";
import { toast } from "@repo/ui/components/sonner";

import { getEditorHostIo } from "@repo/editor/host-io";
import type { EditorHostIo } from "@repo/editor/host-io";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { editsLand } from "@repo/editor/edit-guard";
import { getLiveEditor } from "@repo/editor/live-editor";
import { ImageElement } from "@repo/editor/nodes/image-node";
import { OpenItemPlugin } from "@repo/editor/open-item";

const MB = 1024 * 1024;

export const fileTooLarge = (name: string, maxBytes: number) =>
  `“${name}” is larger than ${String(Math.floor(maxBytes / MB))} MB, the most one file can be.`;

export const fileNotKept = (name: string) => `Couldn't add “${name}” to this note. Try again.`;

interface Transfer {
  readonly files: Iterable<File>;
  readonly types: readonly string[];
}

export const filesToKeep = (data: Transfer, from: "paste" | "drop") =>
  (from === "paste" && data.types.includes("text/html") ? [] : [...data.files]) satisfies File[];

const blockOf = (file: File, sha: string) => {
  const children = [{ text: "" }];

  if (file.type.startsWith("image/")) {
    return { children, sha, type: KEYS.img } satisfies TElement;
  }

  if (file.type.startsWith("video/")) {
    return { children, sha, type: KEYS.video } satisfies TElement;
  }

  return {
    children,
    name: file.name === "" ? "File" : file.name,
    sha,
    type: KEYS.file,
  } satisfies TElement;
};

const keepOne = async (io: EditorHostIo, file: File) => {
  try {
    return await io.keepFile(new Uint8Array(await file.arrayBuffer()), keptFileType(file.type));
  } catch {
    return null;
  }
};

const placeFiles = async (editor: SlateEditor, files: readonly File[], at: TRange | null) => {
  const io = getEditorHostIo();
  const itemId = editor.getOption(OpenItemPlugin, "itemId");
  const place = at === null ? null : editor.api.rangeRef(at);
  let last: PathRef | null = null;

  try {
    for (const file of files) {
      if (file.size > io.fileMaxBytes) {
        toast.error(fileTooLarge(file.name, io.fileMaxBytes));
        continue;
      }

      const kept = await keepOne(io, file);

      if (
        kept === null ||
        !editsLand(editor) ||
        itemId === null ||
        getLiveEditor(itemId) !== editor
      ) {
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

const keepFiles = (editor: SlateEditor, files: readonly File[], at: TRange | null) => {
  editor.getOption(OpenItemPlugin, "onFileKeep")(placeFiles(editor, files, at));
};

export const ImageKit = [
  createPlatePlugin({
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
