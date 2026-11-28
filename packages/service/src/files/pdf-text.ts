import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { extractText } from "unpdf";

const paragraphsOfPage = (page: string) =>
  page
    .split(/\n\s*\n/u)
    .map((part) => part.replaceAll(/\s+/gu, " ").trim())
    .filter((part) => part !== "");

const pagesOf = async (bytes: Uint8Array) => {
  try {
    const read = await extractText(Uint8Array.from(bytes), { mergePages: false });

    return read.text;
  } catch (error) {
    console.warn({ error: String(error), event: "pdf-text-unread" });

    return [];
  }
};

export const pdfParagraphs = async (bytes: Uint8Array) => {
  const pages = await pagesOf(bytes);

  const kept: string[] = [];
  let room: number = FILL_LIMITS.articleBytes;

  for (const paragraph of pages.flatMap(paragraphsOfPage)) {
    room -= paragraph.length;

    if (room < 0) {
      break;
    }

    kept.push(paragraph);
  }

  return kept;
};
