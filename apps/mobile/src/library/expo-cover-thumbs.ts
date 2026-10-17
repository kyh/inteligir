// the covers' native half: sizes from expo-file-system, the shrink through expo-image-manipulator,
// and the thumbnail kept in the attachments folder beside its original, so a sign-out clears both.
// Only the composition root imports this; it loads native modules.

import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { AttachmentFiles } from "../notes/attachment-files";
import type { CoverThumbPort } from "./cover-thumbs";

const THUMB_QUALITY = 0.7;

export const createExpoCoverThumbPort = (args: {
  original: CoverThumbPort["original"];
  attachments: AttachmentFiles;
}): CoverThumbPort => ({
  find: async (name) => await args.attachments.find(name),
  original: args.original,
  shrink: async (uri, name, width) => {
    const image = await ImageManipulator.manipulate(uri).resize({ width }).renderAsync();
    const saved = await image.saveAsync({ compress: THUMB_QUALITY, format: SaveFormat.JPEG });
    const made = new File(saved.uri);
    const bytes = await made.bytes();
    try {
      made.delete();
    } catch {
      // a copy left in the cache is the OS's to purge
    }
    return await args.attachments.save(name, bytes);
  },
  size: async (uri) => await Promise.resolve(new File(uri).size),
});
