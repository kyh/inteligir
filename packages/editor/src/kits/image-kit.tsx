import { KEYS, createSlatePlugin, type SlateEditor } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { getEditorHostIo } from "@repo/editor/host-io";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { ImageElement } from "@repo/editor/nodes/image-node";
import { toast } from "@repo/ui/components/sonner";

// The live half is a separate plugin on the same key: DOM paste/drop handlers exist only on React plugins.
const imageBasePlugin = createSlatePlugin({
  key: KEYS.img,
  node: { isElement: true, isVoid: true },
});

export const ImageBaseKit = [imageBasePlugin];

const IMAGE_MIME_RE = /^image\//;

function extFromMime(mime: string): string {
  const subtype = mime.slice("image/".length).split("+")[0] ?? "";
  if (subtype === "jpeg") return ".jpg";
  if (subtype === "svg") return ".svg";
  return subtype ? `.${subtype}` : ".png";
}

function imageFilesFrom(files: FileList | null | undefined): File[] {
  if (!files) return [];
  return [...files].filter((file) => IMAGE_MIME_RE.test(file.type));
}

async function writeAsset(file: File, name: string): Promise<string> {
  const written = await getEditorHostIo().writeVaultAsset({ baseName: name, file });
  return written.path;
}

// Never rejects: the handlers have already eaten the event, so a rejection reaches nobody — toast instead.
export async function ingestImageFiles(editor: SlateEditor, files: File[]): Promise<void> {
  for (const file of files) {
    const name = file.name !== "" ? file.name : `pasted-image${extFromMime(file.type)}`;
    try {
      const url = await writeAsset(file, name);
      insertVoidAndEscape(editor, { children: [{ text: "" }], type: KEYS.img, url });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast.error(`Couldn't add ${name} — ${detail}`);
      return;
    }
  }
}

export const ImageKit = [
  createPlatePlugin({
    key: KEYS.img,
    node: { isElement: true, isVoid: true },
  })
    .withComponent(ImageElement)
    .extend(() => ({
      handlers: {
        // a browser image-copy also ships an <img> in text/html; only a real file paste is intercepted.
        onPaste: ({ editor, event }) => {
          const clipboard = event.clipboardData;
          const files = imageFilesFrom(clipboard.files);
          if (files.length === 0 || clipboard.types.includes("text/html")) return false;
          event.preventDefault();
          void ingestImageFiles(editor, files);
          return true;
        },
        onDrop: ({ editor, event }) => {
          const files = imageFilesFrom(event.dataTransfer.files);
          if (files.length === 0) return false;
          event.preventDefault();
          // drop where the pointer landed, not at the stale caret.
          const at = editor.api.findEventRange(event);
          if (at) editor.tf.select(at);
          void ingestImageFiles(editor, files);
          return true;
        },
      },
    })),
];
