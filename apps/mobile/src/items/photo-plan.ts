// What a photo becomes on its way into the library, apart from the native calls that make it so:
// its size (a phone camera's 12 MP frame is megabytes an item never needs), its type and its
// file's name.

import { formatIsoDate } from "@repo/notes/iso-date";

const PHOTO_MAX_EDGE = 2048;

const pad2 = (n: number): string => String(n).padStart(2, "0");

// the size a photo is scaled to, its long edge at most 2048px; null keeps a photo that already
// fits, since scaling up only adds bytes
export const photoResize = (
  width: number,
  height: number,
): { width: number; height: number } | null => {
  const longEdge = Math.max(width, height);
  if (longEdge <= PHOTO_MAX_EDGE) {
    return null;
  }
  const scale = PHOTO_MAX_EDGE / longEdge;
  return { height: Math.round(height * scale), width: Math.round(width * scale) };
};

export type PhotoType = "image/jpeg" | "image/png";

// a PNG stays one, since a JPEG has no transparency to keep and draws its clear pixels black
export const photoType = (pickedMime: string | null | undefined): PhotoType =>
  pickedMime?.toLowerCase() === "image/png" ? "image/png" : "image/jpeg";

const EXTENSIONS: Readonly<Record<PhotoType, string>> = { "image/jpeg": "jpg", "image/png": "png" };

// to the second, so two devices rarely pick one name; `.` rather than `:`, which not every disk
// takes in a file name
export const photoName = (takenAt: Date, type: PhotoType): string =>
  `Photo ${formatIsoDate(takenAt)} ${pad2(takenAt.getHours())}.${pad2(takenAt.getMinutes())}.${pad2(takenAt.getSeconds())}.${EXTENSIONS[type]}`;
