// Image kit: markdown `![alt](path)` nodes plus the paste/drop ingestion that
// gets image BYTES into the vault (the embed kit is url-only by charter). An
// image pasted or dropped into a Rich note is written under `assets/` (the host
// picks a collision-free name), then inserted as a bare `![](assets/<name>)`
// node — the canonical byte form (no align/width/caption). Non-image
// pastes/drops fall through untouched. Rendering lives in nodes/image-node.tsx.
//
// The bytes take one of TWO transports, picked by size against the number the
// host enforces: a screenshot fits a socket frame, a photo does not.

import { KEYS, createSlatePlugin, type SlateEditor } from "platejs";
import { createPlatePlugin } from "platejs/react";

import { getAssetUpload, getBridge } from "@repo/bridge/client";
import { MAX_INLINE_ASSET_BYTES } from "@repo/bridge/vault";
import { toErrorMessage } from "@repo/bridge/wire-helpers";
import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { ImageElement } from "@repo/editor/nodes/image-node";
import { toast } from "@repo/ui/components/sonner";

// Base (headless) half — void node metadata for the serializer mirror. The
// live React half is a separate plugin instance sharing the `img` key (the
// same base/react split the embed kit uses), because DOM paste/drop handlers
// exist only on React plugins.
const imageBasePlugin = createSlatePlugin({
  key: KEYS.img,
  node: { isElement: true, isVoid: true },
});

export const ImageBaseKit = [imageBasePlugin];

const IMAGE_MIME_RE = /^image\//;
const ASSET_DIR = "assets";

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

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // chunked to avoid a spread stack overflow on big files
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Move one image's bytes into the vault and answer with the path they landed
 * at. The socket frame is the cheap way and the streamed upload is the one that
 * fits anything, so the size decides — against the host's own number, so this
 * never composes a frame the host will refuse. */
async function writeAsset(file: File, name: string): Promise<string> {
  if (file.size > MAX_INLINE_ASSET_BYTES) {
    const { path } = await getAssetUpload()({ dir: ASSET_DIR, name, body: file });
    return path;
  }
  const bytesBase64 = await fileToBase64(file);
  const written = await getBridge().writeVaultAsset({
    dir: ASSET_DIR,
    baseName: name,
    bytesBase64,
  });
  return written.path;
}

/**
 * Write each image to the vault and insert its node at the caret, in order.
 *
 * NEVER REJECTS, and that is the contract rather than a courtesy: both handlers
 * fire this and hand the browser back its event, so a rejection has nobody left
 * to reach — the `preventDefault` already ate the paste, and nothing on the page
 * listens for an unhandled one. A failure would be a paste that produces no
 * image, no message and no trace the user can see. So it produces a message,
 * and stops at the file that failed.
 */
export async function ingestImageFiles(editor: SlateEditor, files: File[]): Promise<void> {
  for (const file of files) {
    const name = file.name !== "" ? file.name : `pasted-image${extFromMime(file.type)}`;
    try {
      const url = await writeAsset(file, name);
      insertVoidAndEscape(editor, { children: [{ text: "" }], type: KEYS.img, url });
    } catch (error) {
      toast.error(`Couldn't add ${name} — ${toErrorMessage(error)}`);
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
        // A file/screenshot paste carries the bitmap in `files`. A browser
        // image-copy ALSO ships an `<img>` in text/html — defer to the normal
        // HTML/markdown paste there so only a real file paste is intercepted.
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
          // Drop the images where they landed, not at the stale caret.
          const at = editor.api.findEventRange(event);
          if (at) editor.tf.select(at);
          void ingestImageFiles(editor, files);
          return true;
        },
      },
    })),
];
