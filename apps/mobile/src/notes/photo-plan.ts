// What a photo becomes on its way into a note, apart from the native calls that make it so: its
// size (a phone camera's 12 MP frame is megabytes a note never needs), its name, and the line that
// embeds it.

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

// to the second, so two devices rarely pick one name; `.` rather than `:`, which not every disk
// takes in a file name
export const photoBaseName = (takenAt: Date): string =>
  `Photo ${formatIsoDate(takenAt)} ${pad2(takenAt.getHours())}.${pad2(takenAt.getMinutes())}.${pad2(takenAt.getSeconds())}.jpg`;

// what makes the note's end a blank line, so the embed is a paragraph of its own
const blankLineAfter = (content: string): string => {
  if (content === "" || content.endsWith("\n\n")) {
    return "";
  }
  return content.endsWith("\n") ? "\n" : "\n\n";
};

// the note's new last line, spelled as the Mac's editor saves an image at a vault path: in angle
// brackets, since a photo's name holds spaces
export const withPhotoEmbed = (content: string, assetPath: string): string =>
  `${content}${blankLineAfter(content)}![](<${assetPath}>)\n`;
