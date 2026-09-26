import { KEYS, createSlatePlugin } from "platejs";
import type { SlateEditor } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { getEditorHostIo } from "@repo/editor/host-io";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { isLiveEditor } from "@repo/editor/live-editor";
import { ImageElement } from "@repo/editor/nodes/image-node";
import { toast } from "@repo/ui/components/sonner";

// The live half is a separate plugin on the same key: DOM paste/drop handlers exist only on React plugins.
const imageBasePlugin = createSlatePlugin({
  key: KEYS.img,
  node: { isElement: true, isVoid: true },
});

export const ImageBaseKit = [imageBasePlugin];

const extFromMime = (mime: string): string => {
  const subtype = mime.slice("image/".length).split("+")[0] ?? "";
  if (subtype === "jpeg") {
    return ".jpg";
  }
  if (subtype === "svg") {
    return ".svg";
  }
  return subtype ? `.${subtype}` : ".png";
};

const imageFilesFrom = (files: FileList | null | undefined): File[] => {
  if (!files) {
    return [];
  }
  return [...files].filter((file) => file.type.startsWith("image/"));
};

const writeAsset = async (file: File, name: string): Promise<string> => {
  const written = await getEditorHostIo().writeVaultAsset({ baseName: name, file });
  return written.path;
};

// A paste, a drop and a host's photo picker all land their written image here, so the three agree
// on the bytes. False when the note closed while the image was written: it is in the vault and in
// no note, and the toast says where it went.
export const insertVaultImage = (editor: SlateEditor, path: string): boolean => {
  if (!isLiveEditor(editor)) {
    toast.warning(`Added ${path} to the vault, but its note closed before the image landed`);
    return false;
  }
  insertVoidAndEscape(editor, { children: [{ text: "" }], type: KEYS.img, url: path });
  return true;
};

// Never rejects: the handlers have already eaten the event, so a rejection reaches nobody — toast instead.
export const ingestImageFiles = async (editor: SlateEditor, files: File[]): Promise<void> => {
  for (const file of files) {
    const name = file.name === "" ? `pasted-image${extFromMime(file.type)}` : file.name;
    try {
      const path = await writeAsset(file, name);
      if (!insertVaultImage(editor, path)) {
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast.error(`Couldn't add ${name} — ${detail}`);
      return;
    }
  }
};

export const ImageKit = [
  createPlatePlugin({
    key: KEYS.img,
    node: { isElement: true, isVoid: true },
  })
    .withComponent(ImageElement)
    .extend(() => ({
      handlers: {
        onDrop: ({ editor, event }) => {
          const files = imageFilesFrom(event.dataTransfer.files);
          if (files.length === 0) {
            return false;
          }
          event.preventDefault();
          // drop where the pointer landed, not at the stale caret.
          const at = editor.api.findEventRange(event);
          if (at) {
            editor.tf.select(at);
          }
          void ingestImageFiles(editor, files);
          return true;
        },
        // a browser image-copy also ships an <img> in text/html; only a real file paste is intercepted.
        onPaste: ({ editor, event }) => {
          const clipboard = event.clipboardData;
          const files = imageFilesFrom(clipboard.files);
          if (files.length === 0 || clipboard.types.includes("text/html")) {
            return false;
          }
          event.preventDefault();
          void ingestImageFiles(editor, files);
          return true;
        },
      },
    })),
];
