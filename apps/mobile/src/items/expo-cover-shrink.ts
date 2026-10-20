// A saved link's cover, kept on the phone as the Mac keeps it: at most 640 px on its long edge,
// through the system's own image decoder (expo-image-manipulator, as a photo is), a PNG kept a PNG
// for its transparency and anything else a JPEG at 80. The bytes pass through a cache file, since
// the decoder reads a file; a picture it cannot decode (an SVG, a broken one) is no cover. Only the
// composition root imports this; it loads native modules.

import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { FILL_LIMITS } from "@repo/notes/items/link-fill";
import type { ShrunkCover } from "./link-fill";

const JPEG_QUALITY = 0.8;

const removed = (file: File): void => {
  try {
    file.delete();
  } catch {
    // a copy left in the cache is the OS's to purge
  }
};

export const shrinkCover = async (picture: {
  bytes: Uint8Array;
  mediaType: string;
}): Promise<ShrunkCover | null> => {
  const source = new File(
    Paths.cache,
    `cover-${String(Date.now())}-${String(picture.bytes.length)}`,
  );
  try {
    source.write(picture.bytes);
    const original = await ImageManipulator.manipulate(source.uri).renderAsync();
    const longEdge = Math.max(original.width, original.height);
    const image =
      longEdge <= FILL_LIMITS.coverEdge
        ? original
        : await ImageManipulator.manipulate(original)
            .resize(
              original.width >= original.height
                ? { width: FILL_LIMITS.coverEdge }
                : { height: FILL_LIMITS.coverEdge },
            )
            .renderAsync();
    const png = picture.mediaType === "image/png";
    const saved = await image.saveAsync({
      compress: JPEG_QUALITY,
      format: png ? SaveFormat.PNG : SaveFormat.JPEG,
    });
    const made = new File(saved.uri);
    const bytes = await made.bytes();
    removed(made);
    return { bytes, mediaType: png ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  } finally {
    removed(source);
  }
};
