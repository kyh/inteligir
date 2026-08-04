// ---------------------------------------------------------------------------
// Chat-message wire types shared between renderer and host over the Bridge
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
  // A sender that may retry (the mobile outbox: a phone backgrounds mid-request
  // and cannot know whether the host ran the turn) mints this before the first
  // attempt and reuses it, so the host can drop the repeat instead of running
  // the message twice. Senders that never retry omit it.
  clientId: Type.Optional(Type.String({ minLength: 1 })),
};

/** Messages sent between renderer and agent over the Bridge. */
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
