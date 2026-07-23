// ---------------------------------------------------------------------------
// Chat-message wire types shared between main <-> preload <-> renderer
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

// Image attachments — base64 data + mime, matches pi-ai's ImageContent shape.
const ImageAttachmentSchema = Type.Object(
  {
    data: Type.String({ minLength: 1 }),
    mimeType: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type ImageAttachment = Static<typeof ImageAttachmentSchema>;

const TextWithImagesObject = {
  text: Type.String(),
  images: Type.Optional(Type.Array(ImageAttachmentSchema)),
};

/** Messages sent between renderer and agent via IPC. */
export const TextChatMessageSchema = Type.Union([
  Type.Object(
    { type: Type.Literal("user_message"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("steer"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal("follow_up"), ...TextWithImagesObject },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal("interrupt") }, { additionalProperties: false }),
]);

export type TextChatMessage = Static<typeof TextChatMessageSchema>;
