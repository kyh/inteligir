// A card's cover drawn small, through the system's own image decoder (expo-image-manipulator): at
// a card's width, in PNG for any source that can carry transparency (a PNG, a WebP, a GIF) and in
// JPEG only for a JPEG, since a JPEG writes transparent pixels black. The bytes pass through a
// cache file, since the decoder reads a file; a picture it cannot decode is no thumbnail. Only the
// composition root imports this; it loads native modules.

import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { thumbFormatOf } from "./file-cache";
import type { ShrunkCover } from "./file-cache";

// a card's width at 3x, so the thumbnail is sharp on every iPhone
const THUMB_WIDTH = 320;
const JPEG_QUALITY = 0.7;

const removed = (file: File): void => {
  try {
    file.delete();
  } catch {
    // a copy left in the cache is the OS's to purge
  }
};

export const shrinkToThumbnail = async (
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<ShrunkCover | null> => {
  const source = new File(Paths.cache, `thumb-${String(Date.now())}-${String(bytes.length)}`);
  try {
    source.write(bytes);
    const original = await ImageManipulator.manipulate(source.uri).renderAsync();
    const image =
      original.width <= THUMB_WIDTH
        ? original
        : await ImageManipulator.manipulate(original).resize({ width: THUMB_WIDTH }).renderAsync();
    const format = thumbFormatOf(mime);
    const saved = await image.saveAsync({
      compress: JPEG_QUALITY,
      format: format === "png" ? SaveFormat.PNG : SaveFormat.JPEG,
    });
    const made = new File(saved.uri);
    const shrunk = await made.bytes();
    removed(made);
    return { bytes: shrunk, mime: format === "png" ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  } finally {
    removed(source);
  }
};
