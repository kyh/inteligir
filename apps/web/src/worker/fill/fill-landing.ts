// What the cloud read of a page, as its consumer hands it to the account's cell in one call
// (`LibraryDO.landFill`): the page's article and facts with the files it kept, a file the address
// answered with, or why nothing could be read. The cell parses it at its door, so a consumer of an
// older deploy that sends another shape is refused there rather than half landed, and the consumer
// checks its own reading by the same schema first, so one the door would refuse is said in its item.

import { TEXT_NOT_SAVED } from "@repo/service/items/fill-sentences";
import { ordSchema } from "@repo/contract/library/block-order";
import { libraryItemFieldsSchema, SHA256_HEX_RE } from "@repo/contract/library/library-item";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import { z } from "zod";

import type { FillJob } from "./fill-job";

const FIELDS = libraryItemFieldsSchema.shape;
const sha = z.string().regex(SHA256_HEX_RE);

// the item the reading was asked for, and the address it held then
const asked = {
  itemId: z.string().min(1).max(128),
  url: FIELDS.url.unwrap(),
};

export const fillLandingSchema = z.discriminatedUnion("kind", [
  // a page: its article (none when it held no text the editor keeps), what it says of itself, and
  // the cover kept from it; `finalUrl` is where its redirects ended
  z.strictObject({
    ...asked,
    article: z.array(z.strictObject({ block: storableBlockSchema, ord: ordSchema })),
    coverSha: sha.nullable(),
    facts: z.strictObject({
      author: FIELDS.author,
      description: FIELDS.description,
      lang: FIELDS.lang,
      published: FIELDS.published,
      site: FIELDS.site,
    }),
    finalUrl: FIELDS.url.unwrap(),
    kind: z.literal("read"),
    // a link that answered as a video or a song says so
    playable: z.enum(["video", "audio"]).nullable(),
    title: z.string().min(1).max(1000).nullable(),
  }),
  // a picture or a PDF the address answered with, kept as the item's original
  z.strictObject({
    ...asked,
    fileKind: z.enum(["image", "pdf"]),
    kind: z.literal("file"),
    originalName: FIELDS.originalName.unwrap(),
    originalSha: sha,
  }),
  // nothing could be read: the sentence the item says why in
  z.strictObject({ ...asked, kind: z.literal("failed"), sentence: FIELDS.fetchError.unwrap() }),
]);
export type FillLanding = z.infer<typeof fillLandingSchema>;

// a reading as the door takes it: one it would refuse lands nothing there, which would leave the
// item waiting for good, so it is said instead as a page whose text couldn't be saved
export const checkedLanding = (job: FillJob, landing: FillLanding): FillLanding => {
  const parsed = fillLandingSchema.safeParse(landing);
  if (parsed.success) {
    return parsed.data;
  }
  console.warn({ event: "fill-landing-malformed", issues: parsed.error.issues.length });
  return { itemId: job.itemId, kind: "failed", sentence: TEXT_NOT_SAVED, url: job.url };
};

// what the cell made of it: read into the item, said as failed, or nothing, since the item no
// longer waits for that reading
export const fillLandedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("filled") }),
  z.object({ kind: z.literal("failed") }),
  z.object({ kind: z.literal("stale") }),
]);
export type FillLanded = z.infer<typeof fillLandedSchema>;
