import { FILL_LIMITS } from "@repo/contract/items/link-fill";
import { sniffMedia } from "@repo/contract/items/sniff-media";
import { APICallError, generateText } from "ai";

import { gatewayReachable } from "../agent/availability";

const READER_MODEL = "anthropic/claude-haiku-5.5";

const IMAGE_BYTES_MAX = 3_750_000;

const READABLE = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

const NO_TEXT = "NO TEXT";

const ASK = `Transcribe every word of text visible in this picture, in reading order, as plain paragraphs separated by blank lines. Keep the wording, spelling and language as written; add nothing of your own, no description and no markdown. If the picture holds no text, answer exactly: ${NO_TEXT}`;

export const transcriptParagraphs = (transcript: string) => {
  if (transcript.trim() === NO_TEXT) {
    return [];
  }

  const kept: string[] = [];
  let room: number = FILL_LIMITS.articleBytes;

  for (const part of transcript.split(/\n\s*\n/u)) {
    const paragraph = part.replaceAll(/\s+/gu, " ").trim();
    room -= paragraph.length;

    if (room < 0) {
      break;
    }

    if (paragraph !== "") {
      kept.push(paragraph);
    }
  }

  return kept;
};

export const imageParagraphs = async (bytes: Uint8Array) => {
  const sniffed = sniffMedia(bytes);

  if (
    !gatewayReachable() ||
    sniffed?.kind !== "image" ||
    !READABLE.has(sniffed.mediaType) ||
    bytes.byteLength > IMAGE_BYTES_MAX
  ) {
    return [];
  }

  try {
    const { text } = await generateText({
      maxOutputTokens: 4000,
      maxRetries: 1,
      messages: [
        {
          content: [
            { image: bytes, mediaType: sniffed.mediaType, type: "image" },
            { text: ASK, type: "text" },
          ],
          role: "user",
        },
      ],
      model: READER_MODEL,
    });

    return transcriptParagraphs(text);
  } catch (error) {
    if (APICallError.isInstance(error) && error.isRetryable) {
      throw error;
    }

    console.warn({ error: String(error), event: "image-text-unread" });

    return [];
  }
};
