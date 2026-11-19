import { z } from "zod";
import { isWebUrl } from "@repo/contract/items/item-url";
import { fieldLine } from "@repo/contract/items/saved-facts";
import { linkInText, withoutLink } from "./link-in-text";

export const shareSaveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("link"),
    note: z.string().nullable(),
    title: z.string().nullable(),
    url: z.string(),
  }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

export type ShareSave = z.infer<typeof shareSaveSchema>;

type SharedSave = ShareSave | { kind: "nothing" };

export interface ShareHandoff {
  webUrl: string | null;
  text: string | null;
  meta: Record<string, string> | null;
}

const filled = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
};

const besideLink = (text: string, url: string) => {
  const left = filled(withoutLink(text, url));

  return left !== null && /[\p{L}\p{N}]/u.test(left) ? left : null;
};

export const sharedSaveOf = (intent: ShareHandoff) => {
  const handed = filled(intent.webUrl);
  const given = handed !== null && isWebUrl(handed) ? handed : null;
  const text = filled(intent.text);

  const title =
    fieldLine(intent.meta?.title ?? null) ?? fieldLine(intent.meta?.["og:title"] ?? null);

  if (text === null || text === given) {
    return (
      given === null ? { kind: "nothing" } : { kind: "link", note: null, title, url: given }
    ) satisfies SharedSave;
  }

  const url = linkInText(text)?.url ?? given;

  return (
    url === null
      ? { kind: "text", text }
      : { kind: "link", note: besideLink(text, url), title, url }
  ) satisfies SharedSave;
};

export const isShareHandoff = (path: string) =>
  /^(?:[a-z][\d+.a-z-]*:\/\/)?\/?dataUrl=/iu.test(path);
