import { formatIsoDate } from "@repo/contract/iso-date";

const PHOTO_MAX_EDGE = 2048;

const pad2 = (n: number) => String(n).padStart(2, "0");

export const photoResize = (width: number, height: number) => {
  const longEdge = Math.max(width, height);

  if (longEdge <= PHOTO_MAX_EDGE) {
    return null;
  }

  const scale = PHOTO_MAX_EDGE / longEdge;

  return { height: Math.round(height * scale), width: Math.round(width * scale) } satisfies {
    width: number;
    height: number;
  } | null;
};

export type PhotoType = "image/jpeg" | "image/png";

export const photoType = (pickedMime: string | null | undefined) =>
  (pickedMime?.toLowerCase() === "image/png" ? "image/png" : "image/jpeg") satisfies PhotoType;

const EXTENSIONS: Readonly<Record<PhotoType, string>> = { "image/jpeg": "jpg", "image/png": "png" };

export const photoName = (takenAt: Date, type: PhotoType) =>
  `Photo ${formatIsoDate(takenAt)} ${pad2(takenAt.getHours())}.${pad2(takenAt.getMinutes())}.${pad2(takenAt.getSeconds())}.${EXTENSIONS[type]}`;
