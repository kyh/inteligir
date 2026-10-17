// every write procedure attributes what it wrote to the agent turn that asked, then answers the
// result without it. ItemsError is translated through one total table, vault refusals through
// vaultWireError.

import { ORPCError } from "@orpc/server";

import { attributeWrites, base, refusing } from "../orpc";
import type { AppContext } from "../orpc";
import { vaultWireError } from "../vault/vault-refusals";
import { ItemsError } from "./items-error";
import type { ItemsErrorCode } from "./items-error";

const ITEMS_REFUSALS = {
  "folder-is-file": "CONFLICT",
  "has-highlights": "CONFLICT",
  "names-exhausted": "CONFLICT",
  "not-a-file-name": "INVALID_PATH",
  "not-found": "NOT_FOUND",
  "not-url-item": "BAD_REQUEST",
  "too-large": "PAYLOAD_TOO_LARGE",
} as const satisfies Record<
  ItemsErrorCode,
  "BAD_REQUEST" | "CONFLICT" | "INVALID_PATH" | "NOT_FOUND" | "PAYLOAD_TOO_LARGE"
>;

const asWireError = (cause: unknown): ORPCError<string, unknown> | null =>
  cause instanceof ItemsError
    ? new ORPCError(ITEMS_REFUSALS[cause.code], { message: cause.message })
    : vaultWireError(cause);

const itemsRefusals = refusing(asWireError);

const attributed = <T extends { wrote: string[] }>(
  context: AppContext,
  { wrote, ...answer }: T,
): Omit<T, "wrote"> => {
  attributeWrites(context, wrote);
  return answer;
};

const saveLink = base.items.saveLink
  .use(itemsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.items.saveLink(input)));

const savePage = base.items.savePage
  .use(itemsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.items.savePage(input)));

const saveFile = base.items.saveFile
  .use(itemsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.items.saveFile(input)));

const refresh = base.items.refresh
  .use(itemsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.items.refresh(input)));

const tag = base.items.tag
  .use(itemsRefusals)
  .handler(async ({ context, input }) => attributed(context, await context.items.tag(input)));

export const itemsRouter = {
  refresh,
  saveFile,
  saveLink,
  savePage,
  tag,
};
