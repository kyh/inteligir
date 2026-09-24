// Every channel the bridge carries, declared once: its name, what the page sends and what
// main answers. Main's handler and the preload's invoke are both typed from the row, and
// each end parses what it receives, so a frame from a stranger or from a build this end
// does not know fails at the parse. A refusal is an answer, never a throw: Electron hands
// the page a thrown error's message wrapped in its own words.

import { z } from "zod";
import { pathActionRequestSchema, pathActionResultSchema } from "./path-action";
import { spellcheckChoiceSchema, spellcheckStateSchema } from "./spellcheck-state";
import { updateStateSchema } from "./update-state";
import { vaultPathSchema, vaultsStateSchema, vaultSwitchAnswerSchema } from "./vaults-state";

// the page asks, main answers
export interface InvokeRoute<Request extends z.ZodType, Answer extends z.ZodType> {
  readonly channel: string;
  readonly request: Request;
  readonly answer: Answer;
}

// main tells the page, unasked
export interface PushRoute<Frame extends z.ZodType> {
  readonly channel: string;
  readonly frame: Frame;
}

const route = <Request extends z.ZodType, Answer extends z.ZodType>(
  channel: string,
  request: Request,
  answer: Answer,
): InvokeRoute<Request, Answer> => ({ answer, channel, request });

// a channel the page asks with no frame
const noRequest = z.undefined();

export const INVOKE_ROUTES = {
  paths: {
    open: route("desktop:open-path", pathActionRequestSchema, pathActionResultSchema),
    reveal: route("desktop:reveal-path", pathActionRequestSchema, pathActionResultSchema),
  },
  spellcheck: {
    apply: route("desktop:spellcheck-apply", spellcheckChoiceSchema, spellcheckStateSchema),
    getState: route("desktop:spellcheck-get-state", noRequest, spellcheckStateSchema),
  },
  updates: {
    check: route("desktop:update-check", noRequest, updateStateSchema),
    download: route("desktop:update-download", noRequest, updateStateSchema),
    getState: route("desktop:update-get-state", noRequest, updateStateSchema),
    install: route("desktop:update-install", noRequest, updateStateSchema),
  },
  vaults: {
    // forgetting a row cannot be refused, so it answers the state alone
    forget: route("desktop:vaults-forget", vaultPathSchema, vaultsStateSchema),
    getState: route("desktop:vaults-get-state", noRequest, vaultsStateSchema),
    open: route("desktop:vaults-open", vaultPathSchema, vaultSwitchAnswerSchema),
    pick: route("desktop:vaults-pick", noRequest, vaultSwitchAnswerSchema),
  },
} as const;

export const UPDATE_STATE_PUSH: PushRoute<typeof updateStateSchema> = {
  channel: "desktop:update-state",
  frame: updateStateSchema,
};

// asked synchronously at preload load: the renderer needs the origin before its first socket
export const SOCKET_ORIGIN_CHANNEL = "desktop:socket-origin";
export const socketOriginSchema = z.url();
