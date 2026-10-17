// the /browser wire adapted to /local: each request the extension sends becomes one call on the
// app's server, and each answer or refusal one reply. The wire breaks only behind its own version,
// so a request is read by its `v` before its shape, and a peer on either side of the window is told
// which of the two to update. A page never names what the host saves: an image's bytes are kept
// only under a media type the library serves as an image.

import path from "node:path";
import {
  BROWSER_WIRE_FLOOR,
  BROWSER_WIRE_VERSION,
  browserHostRequestSchema,
} from "@repo/contract/browser/browser-wire";
import type {
  BrowserHostReply,
  BrowserHostRequest,
  BrowserRefusal,
  BrowserSave,
} from "@repo/contract/browser/browser-wire";
import { VAULT_ASSET_MEDIA_TYPES } from "@repo/contract/cloud/vault/vault-schema";
import type { ItemSaveResponse } from "@repo/contract/local/items/items-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { z } from "zod";
import { getErrorMessage, isOrpcError, isUnreachable } from "../cli-error";
import type { Api } from "../context";
import { createLocalClient } from "../server/local-client";
import type { FrameEvent } from "./frames";
import type { OpenApp } from "./open-app";
import type { Reach } from "./reach-server";

// a save answers before its fill (`wait: false`), so this bounds only a wedged server
const CALL_TIMEOUT_MS = 60_000;
// a reply is one frame under Chrome's 1 MiB cap whatever a server's message says
const DETAIL_MAX_CHARS = 2000;

export type RefusedReply = Extract<BrowserHostReply, { type: "refused" }>;

export const refusedReply = (reason: BrowserRefusal, detail: string): RefusedReply => ({
  detail: detail.slice(0, DETAIL_MAX_CHARS),
  reason,
  type: "refused",
  v: BROWSER_WIRE_VERSION,
});

export type Incoming =
  | { kind: "request"; request: BrowserHostRequest }
  | { kind: "refused"; reply: RefusedReply };

const versionSchema = z.object({ v: z.number().int() });

// the fields whose size is the page's own, so a refusal over them is the page being too big
const SIZED_FIELDS = new Set<PropertyKey>(["base64", "html"]);

const refusedIncoming = (reason: BrowserRefusal, detail: string): Incoming => ({
  kind: "refused",
  reply: refusedReply(reason, detail),
});

export const incomingOf = (event: FrameEvent): Incoming => {
  if (event.kind === "malformed") {
    return refusedIncoming("failed", "That message is not one Inteligir reads.");
  }
  const versioned = versionSchema.safeParse(event.value);
  if (!versioned.success) {
    return refusedIncoming("failed", "That message names no version of the browser wire.");
  }
  const { v } = versioned.data;
  if (v > BROWSER_WIRE_VERSION) {
    return refusedIncoming(
      "update-app",
      `The extension speaks version ${String(v)}, and this Inteligir speaks ${String(BROWSER_WIRE_VERSION)}.`,
    );
  }
  if (v < BROWSER_WIRE_FLOOR) {
    return refusedIncoming(
      "update-extension",
      `The extension speaks version ${String(v)}, and this Inteligir reads ${String(BROWSER_WIRE_FLOOR)} or later.`,
    );
  }
  const parsed = browserHostRequestSchema.safeParse(event.value);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some(
      (issue) => issue.code === "too_big" && SIZED_FIELDS.has(issue.path.at(-1) ?? ""),
    );
    return tooBig
      ? refusedIncoming("too-large", "The page is bigger than Inteligir keeps.")
      : refusedIncoming("failed", parsed.error.message);
  }
  return { kind: "request", request: parsed.data };
};

const reasonOfReach = (reach: Exclude<Reach, { kind: "reached" }>): BrowserRefusal => {
  switch (reach.kind) {
    case "not-set-up": {
      return "not-set-up";
    }
    case "unavailable": {
      return "app-unavailable";
    }
    case "failed": {
      return "failed";
    }
    default: {
      const exhaustive: never = reach;
      return exhaustive;
    }
  }
};

// a media type's parameters and case are the page's spelling, never part of the type
const imageExtensionOf = (mime: string): string | null => {
  const [type = ""] = mime.split(";");
  const mediaType = type.trim().toLowerCase();
  for (const [extension, row] of VAULT_ASSET_MEDIA_TYPES) {
    if (row.kind === "image" && row.mediaType === mediaType) {
      return extension;
    }
  }
  return null;
};

type SaveAnswer =
  | { kind: "saved"; response: ItemSaveResponse }
  | { kind: "refused"; reply: RefusedReply };

const saved = (response: ItemSaveResponse): SaveAnswer => ({ kind: "saved", response });

// a title or a selection of only spaces is none, which /local's trimmed fields would refuse
const presentText = (text: string | null): string | null =>
  text === null || text.trim() === "" ? null : text;

const saveOf = async (api: Api, save: BrowserSave): Promise<SaveAnswer> => {
  switch (save.target) {
    case "page": {
      const text = presentText(save.page.selection?.text ?? null);
      return saved(
        await api.items.savePage({
          keepCopy: save.keepCopy,
          page: {
            html: save.page.html,
            selection: text === null ? null : { text },
            title: save.page.title,
            url: save.page.url,
          },
          wait: false,
        }),
      );
    }
    case "link": {
      const title = presentText(save.title);
      return saved(
        await api.items.saveLink(
          title === null ? { url: save.url, wait: false } : { title, url: save.url, wait: false },
        ),
      );
    }
    case "image": {
      const { src } = save;
      if (src.kind === "url") {
        return saved(await api.items.saveLink({ url: src.url, wait: false }));
      }
      const extension = imageExtensionOf(src.mime);
      if (extension === null) {
        return {
          kind: "refused",
          reply: refusedReply("unsupported-page", `${src.mime} is not a picture Inteligir keeps.`),
        };
      }
      const bytes = new Uint8Array(Buffer.from(src.base64, "base64"));
      if (bytes.length === 0) {
        return {
          kind: "refused",
          reply: refusedReply("unsupported-page", "The picture holds no bytes."),
        };
      }
      const [type = ""] = src.mime.split(";");
      return saved(
        await api.items.saveFile({
          file: new Blob([bytes], { type: type.trim().toLowerCase() }),
          name: `image${extension}`,
        }),
      );
    }
    default: {
      const exhaustive: never = save;
      return exhaustive;
    }
  }
};

// the server's refusal in the extension's reasons: its message rides as the detail, for a report
const refusalOf = (cause: unknown): RefusedReply => {
  const detail = getErrorMessage(cause);
  if (isOrpcError(cause)) {
    if (cause.code === "PAYLOAD_TOO_LARGE") {
      return refusedReply("too-large", detail);
    }
    if (cause.code === "BAD_REQUEST") {
      return refusedReply("unsupported-page", detail);
    }
    return refusedReply("failed", detail);
  }
  return refusedReply(isUnreachable(cause) ? "app-unavailable" : "failed", detail);
};

export interface AnswerDeps {
  openApp: OpenApp;
  reach: () => Promise<Reach>;
}

export const answerRequest = async (
  request: BrowserHostRequest,
  deps: AnswerDeps,
): Promise<BrowserHostReply> => {
  if (request.type === "open-app") {
    return deps.openApp("front")
      ? { type: "opened", v: BROWSER_WIRE_VERSION }
      : refusedReply("app-unavailable", "There is no Inteligir app on this computer to open.");
  }
  const reach = await deps.reach();
  if (reach.kind !== "reached") {
    return refusedReply(reasonOfReach(reach), reach.detail);
  }
  const api = createLocalClient({
    origin: reach.server.baseUrl,
    timeoutMs: CALL_TIMEOUT_MS,
    token: reach.server.token,
  });
  try {
    if (request.type === "hello") {
      const status = await api.system.status();
      return {
        appVersion: status.version,
        library: path.basename(status.vaultDir),
        type: "hello",
        v: BROWSER_WIRE_VERSION,
      };
    }
    const answer = await saveOf(api, request.save);
    if (answer.kind === "refused") {
      return answer.reply;
    }
    const { outcome, path: itemPath } = answer.response;
    return {
      created: outcome === "created",
      path: itemPath,
      title: docStem(itemPath),
      type: "saved",
      v: BROWSER_WIRE_VERSION,
    };
  } catch (error) {
    return refusalOf(error);
  }
};
