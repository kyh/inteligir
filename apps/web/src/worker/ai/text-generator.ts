// ---------------------------------------------------------------------------
// The editor's AI: no-tools text turns, run DIRECTLY from the Durable Object.
//
// WHY NOT THE CONTAINER. The desktop ran these as two extra pi sessions in the
// same process, which cost nothing because the process was already there. Here
// the agent lives in a container whose ordinary state is asleep, so routing a
// ghost completion through it would pay a cold start, a whole-vault
// materialization and a pi boot for a request that needs no filesystem and no
// tools. The container is for TOOL-USING turns; this is a text call over the
// same credential the container never gets to hold.
//
// WHAT IT COSTS, stated rather than discovered. An outbound `fetch` PINS the
// Durable Object: it cannot hibernate while one is open, and the wall-clock
// time is billed as duration. Ghost text fires per typing pause, so an
// unbounded version of this module would keep one object resident for as long
// as someone is typing. Three bounds, and they are the whole cost story:
//
//   • ONE request in flight per LANE, and there are exactly two lanes
//     (`inline`, `ghost`). So an object holds at most two provider connections
//     — well inside the six a Durable Object may have — and a user cannot
//     multiply them by typing faster.
//   • A NEW request in a lane ABORTS the one it supersedes before it starts.
//     Ghost text's supersede semantics are therefore also its cost control: the
//     pin ends with the keystroke that invalidated it, not with the completion
//     nobody will read.
//   • EVERY request has a deadline, and the ghost deadline is the short one.
//     A provider that hangs must not hold an object resident for a minute.
//
// The lane state is IN MEMORY on purpose, and that is not a hibernation
// violation: an `AbortController` is only meaningful while its request is open,
// and a request is only open while the object is pinned. An object that WAS
// evicted has nothing left to cancel, so a cancel that finds an empty lane is
// correct rather than a lost message.
// ---------------------------------------------------------------------------

import {
  parseAiIntent,
  type AiGenerateResult,
  type AiIntentResult,
  type GhostModelsResult,
  type GhostTextResult,
} from "@repo/bridge/inline-ai";
import { toErrorMessage } from "@repo/bridge/wire-helpers";

import { chooseProvider, type ProviderChoice, type ProviderEntry } from "../agent/provider-catalog";
import type { ProviderCredentials } from "../agent/provider-credentials";
import {
  buildCompletionRequest,
  completionHeaders,
  drainSseEvents,
  readCompletionText,
  readStreamDelta,
  type CompletionParams,
} from "./provider-wire";

/** A ⌘J generation. Generous — it writes paragraphs, and the user is watching
 * it stream. */
const INLINE_TIMEOUT_MS = 60_000;
/** Intent classification. It answers one word. */
const CLASSIFY_TIMEOUT_MS = 15_000;
/**
 * A ghost completion. Deliberately far shorter than the desktop's twenty
 * seconds: there, a slow completion cost a background promise; here it costs a
 * resident Durable Object, and a suggestion that arrives after the user has
 * typed past it is worthless anyway.
 */
const GHOST_TIMEOUT_MS = 8_000;

const INLINE_MAX_TOKENS = 2_048;
const CLASSIFY_MAX_TOKENS = 8;
/** A completion is the rest of a sentence or two, never a paragraph. */
const GHOST_MAX_TOKENS = 96;

/** The two independent request lanes. Naming them is what makes "at most two
 * outbound connections" a fact of the type rather than of a comment. */
type Lane = "inline" | "ghost";

/** What a completion produced, as a value. Every failure — a refusal, a
 * timeout, a cancel, a provider that is down — is one of these, because every
 * one of them renders as a line in the editor rather than as an exception. */
type CompletionOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

/** One in-flight request, as its lane holds it. */
type InFlight = { readonly requestId: string; readonly controller: AbortController };

export type TextGeneratorDeps = {
  readonly env: Env;
  readonly credentials: ProviderCredentials;
  /** Bound rather than passed bare: `fetch` on workerd is an unbound global,
   * and a method-shaped reference to it throws on call. */
  readonly fetch: typeof fetch;
  /** Push one streamed delta to this user's sockets (`onAiStreamed`). */
  readonly emitDelta: (requestId: string, delta: string) => void;
};

export class TextGenerator {
  private readonly deps: TextGeneratorDeps;
  private readonly lanes = new Map<Lane, InFlight>();

  constructor(deps: TextGeneratorDeps) {
    this.deps = deps;
  }

  // ---- the three surfaces ---------------------------------------------------

  /** One ⌘J generation, streamed: each delta reaches the editor over
   * `onAiStreamed` as it arrives, and the final text is the return value. */
  async generate(prompt: string, requestId: string): Promise<AiGenerateResult> {
    const result = await this.run("inline", requestId, {
      prompt,
      maxTokens: INLINE_MAX_TOKENS,
      timeoutMs: INLINE_TIMEOUT_MS,
      fast: false,
      onDelta: (delta) => {
        this.deps.emitDelta(requestId, delta);
      },
    });
    if (!result.ok) return result;
    return result.text === "" ? { ok: false, error: "No response." } : result;
  }

  /** Abort the in-flight generation if `requestId` still names it. A stale id
   * is a no-op — the turn already finished, or was superseded. */
  cancel(requestId: string): void {
    this.abortLane("inline", requestId);
  }

  /**
   * Classify a free-form AI-menu prompt as generate vs edit.
   *
   * Every failure falls back to `generate`, the non-destructive branch — the
   * same trade the desktop makes, and the reason this one never reports an
   * error: inserting text the user can discard beats rewriting their selection
   * because a classifier timed out.
   */
  async classify(prompt: string, hasSelection: boolean): Promise<AiIntentResult> {
    const result = await this.run("ghost", `classify:${crypto.randomUUID()}`, {
      prompt: classifyPrompt(prompt, hasSelection),
      maxTokens: CLASSIFY_MAX_TOKENS,
      timeoutMs: CLASSIFY_TIMEOUT_MS,
      fast: true,
      onDelta: null,
    });
    return { intent: result.ok ? parseAiIntent(result.text) : "generate" };
  }

  /** One ghost completion on the fast model. A newer request supersedes this
   * one: `run` aborts the lane before it starts, and the superseded caller gets
   * `{ ok: false }`. */
  async ghost(prompt: string, requestId: string): Promise<GhostTextResult> {
    const result = await this.run("ghost", requestId, {
      prompt,
      maxTokens: GHOST_MAX_TOKENS,
      timeoutMs: GHOST_TIMEOUT_MS,
      fast: true,
      onDelta: null,
    });
    if (!result.ok) return result;
    return result.text === "" ? { ok: false, error: "No completion." } : result;
  }

  /** Abort the in-flight completion if `requestId` still names it (the user
   * typed, blurred, or pressed Escape). */
  cancelGhost(requestId: string): void {
    this.abortLane("ghost", requestId);
  }

  /** The models the ghost lane can run — the SELECTED provider's menu, with the
   * catalog's declared fast tier as the default. A provider that is selected
   * but not connected still lists: the Settings picker is how a user chooses
   * before connecting, and an empty menu would read as a broken page. */
  ghostModels(): GhostModelsResult {
    const choice = this.choose();
    const entry = choice.ok ? choice.entry : null;
    if (entry === null) return { models: [], defaultId: null };
    return {
      models: entry.models.map((model) => ({ id: model.id, label: model.label })),
      defaultId: entry.fastModelId,
    };
  }

  // ---- the one request path -------------------------------------------------

  private async run(
    lane: Lane,
    requestId: string,
    params: {
      readonly prompt: string;
      readonly maxTokens: number;
      readonly timeoutMs: number;
      /** Run on the provider's declared fast tier rather than the selection. */
      readonly fast: boolean;
      /** Stream deltas as they arrive, or `null` for a single-shot read. */
      readonly onDelta: ((delta: string) => void) | null;
    },
  ): Promise<CompletionOutcome> {
    const choice = this.choose();
    if (!choice.ok) return { ok: false, error: choice.error };

    // Supersede BEFORE claiming: the abort is what ends the previous request's
    // pin on this object, and it has to happen whether or not this one gets off
    // the ground.
    this.abortLane(lane, null);
    const controller = new AbortController();
    this.lanes.set(lane, { requestId, controller });
    const deadline = setTimeout(() => {
      controller.abort();
    }, params.timeoutMs);

    try {
      const outcome = await this.complete(
        choice.entry,
        {
          modelId: params.fast ? choice.entry.fastModelId : choice.modelId,
          prompt: params.prompt,
          maxTokens: params.maxTokens,
          stream: params.onDelta !== null,
        },
        controller.signal,
        params.onDelta,
      );
      // Superseded or canceled mid-stream: the caller's text is stale, and the
      // editor has already unwound whatever it inserted.
      if (this.lanes.get(lane)?.requestId !== requestId) return { ok: false, error: "Canceled." };
      return outcome;
    } finally {
      clearTimeout(deadline);
      if (this.lanes.get(lane)?.requestId === requestId) this.lanes.delete(lane);
    }
  }

  /**
   * One provider call.
   *
   * `sandbox` never leaves the object: it is the catalog's no-account provider
   * (../agent/provider-catalog), and answering it locally is what lets a whole
   * editor-AI flow be driven with no credential — the same first-class scripted
   * runtime the container has, rather than a mock beside one.
   */
  private async complete(
    entry: ProviderEntry,
    params: CompletionParams,
    signal: AbortSignal,
    onDelta: ((delta: string) => void) | null,
  ): Promise<CompletionOutcome> {
    if (!entry.requiresAuth) {
      const text = scriptedCompletion(params.prompt, params.maxTokens);
      onDelta?.(text);
      return { ok: true, text };
    }
    const minted = await this.deps.credentials.mintAccessToken(entry);
    if (!minted.ok) return { ok: false, error: minted.error };

    const request = buildCompletionRequest(entry, params);
    let response: Response;
    try {
      response = await this.deps.fetch(request.url, {
        method: "POST",
        headers: completionHeaders(entry, minted.token),
        body: request.body,
        signal,
      });
    } catch (error) {
      // An abort and a network failure both land here. They are the same thing
      // to the editor — no text arrived — and the lane check above is what
      // turns a deliberate abort into "Canceled." rather than this sentence.
      return { ok: false, error: toErrorMessage(error, "The AI request could not be sent.") };
    }
    if (!response.ok) {
      return { ok: false, error: `${entry.label} refused the request (${response.status}).` };
    }
    try {
      return onDelta === null
        ? { ok: true, text: readCompletionText(entry, await response.json()) }
        : { ok: true, text: await readStream(entry, response, onDelta) };
    } catch (error) {
      return { ok: false, error: toErrorMessage(error, "The AI response could not be read.") };
    }
  }

  private choose(): ProviderChoice {
    return chooseProvider(this.deps.env, this.deps.credentials.selection(), (provider) =>
      this.deps.credentials.connected(provider),
    );
  }

  /** Abort a lane's request — either whichever one it holds (`null`) or only
   * the one named. */
  private abortLane(lane: Lane, requestId: string | null): void {
    const inFlight = this.lanes.get(lane);
    if (inFlight === undefined) return;
    if (requestId !== null && inFlight.requestId !== requestId) return;
    this.lanes.delete(lane);
    inFlight.controller.abort();
  }
}

/** Read an SSE completion to the end, emitting each delta as it lands. */
async function readStream(
  entry: ProviderEntry,
  response: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const drained = drainSseEvents(buffer);
      buffer = drained.rest;
      for (const event of drained.events) {
        const delta = readStreamDelta(entry, event);
        if (delta === "") continue;
        text += delta;
        onDelta(delta);
      }
    }
  } finally {
    // The stream is what pins the object; releasing the lock is what lets an
    // aborted read stop holding it.
    reader.releaseLock();
  }
  return text;
}

/**
 * What the no-account provider answers.
 *
 * Deterministic and derived from the prompt, so a headless drive can assert an
 * exact string — the cloud twin of the desktop's faux provider echo.
 */
function scriptedCompletion(prompt: string, maxTokens: number): string {
  const tail = prompt.slice(-120).replaceAll(/\s+/g, " ").trim();
  return `[scripted] ${tail}`.slice(0, maxTokens * 4);
}

/** Terse and rigidly formatted — the response is machine-parsed, and
 * `parseAiIntent` resolves anything off-script to `generate`. */
function classifyPrompt(prompt: string, hasSelection: boolean): string {
  return [
    "You are an intent classifier for a notes editor's AI command input.",
    "Classify the user's request as exactly one of two intents:",
    '- "edit": the request asks to CHANGE existing text (rewrite, fix, improve, shorten, lengthen, translate, change tone, reformat).',
    '- "generate": the request asks to PRODUCE new text (continue, write, draft, summarize into a new passage, explain, brainstorm, answer a question).',
    hasSelection
      ? "The user has text selected in the editor."
      : "The user has NO selection — just a cursor position.",
    "Reply with ONLY the single word edit or generate. No punctuation, no explanation.",
    "",
    `User request: ${prompt}`,
  ].join("\n");
}
