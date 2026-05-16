// ---------------------------------------------------------------------------
// Voice types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { z } from "zod";

// Image attachments — base64 data + mime, matches pi-ai's ImageContent shape.
const ImageAttachmentSchema = z.object({
  data: z.string().min(1),
  mimeType: z.string().min(1),
});

export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

const TextWithImagesSchema = z.object({
  text: z.string(),
  images: z.array(ImageAttachmentSchema).optional(),
});

/** Messages sent between renderer and agent via IPC. */
export const TextChatMessageSchema = z.discriminatedUnion("type", [
  TextWithImagesSchema.extend({ type: z.literal("user_message") }),
  TextWithImagesSchema.extend({ type: z.literal("steer") }),
  TextWithImagesSchema.extend({ type: z.literal("follow_up") }),
  z.object({ type: z.literal("interrupt") }),
]);

export type TextChatMessage = z.infer<typeof TextChatMessageSchema>;
