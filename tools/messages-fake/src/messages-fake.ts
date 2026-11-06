// A scripted Claude Messages API with no model and no account behind it, for the local Worker
// (`pnpm dev:web`), the e2e scenarios and the Worker's suites: the built-in agent's client reaches
// it as it reaches AI Gateway, at `<origin>/v1/messages` or the gateway's provider-native path
// (`/v1/<account>/<gateway>/anthropic/v1/messages`), so every thread runs its one code path. It
// answers only a streamed request carrying the gateway's token header, refuses what Claude Opus
// 5.5 refuses (`./fake-request.ts`), checks every replayed thinking block (`./fake-signature.ts`)
// and drops and counts one that fails under `drop_block` instead of refusing, and replies by the
// person's script (`./fake-script.ts`, `./fake-reply.ts`). It keeps no conversation: only its three
// counters, at `/__fake/stats`, and per request body the failures and stalls a script asked for.
// Web-standard throughout, so the suites run it in workerd and `./serve.ts` in node.

import {
  BINDING_BETA,
  COMPACT_BETA,
  issueText,
  requestRefusal,
  requestSchema,
} from "./fake-request.ts";
import type { FakeRequest } from "./fake-request.ts";
import { conversationOf, FAKE_MODEL, planReply } from "./fake-reply.ts";
import type { StreamPlan } from "./fake-reply.ts";
import { scriptOf } from "./fake-script.ts";
import { checkThinking } from "./fake-signature.ts";

const FAKE_STATS_PATH = "/__fake/stats";

// the Messages endpoint, and AI Gateway's provider-native route to it
const MESSAGES_PATH = /^(?:\/v1\/[^/]+\/[^/]+\/anthropic)?\/v1\/messages$/u;

/** @internal */
export interface FakeStats {
  // the Messages requests answered, refusals and failures included
  readonly requests: number;
  // the replies a stall held open mid-stream, each until its client went: a suite that cuts or
  // stops a reply waits for this, so what it cuts is mid-reply
  readonly held: number;
  // the replayed thinking blocks dropped under `drop_block`, each one a request the client got wrong
  readonly drops: number;
}

export interface MessagesFake {
  // the platform's fetch, as a client takes one
  readonly fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly stats: () => FakeStats;
}

const ERROR_TYPES = new Map([
  [400, "invalid_request_error"],
  [401, "authentication_error"],
  [404, "not_found_error"],
  [408, "timeout_error"],
  [409, "conflict_error"],
  [429, "rate_limit_error"],
  [529, "overloaded_error"],
]);

const failure = (status: number, message: string, requestId: string): Response =>
  Response.json(
    {
      error: { message, type: ERROR_TYPES.get(status) ?? "api_error" },
      request_id: requestId,
      type: "error",
    },
    { headers: { "request-id": requestId }, status },
  );

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const bodyHash = async (body: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));

const parsedBody = (body: string) => {
  try {
    return requestSchema.safeParse(JSON.parse(body));
  } catch {
    return null;
  }
};

const encoder = new TextEncoder();

const pause = async (ms: number): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- a timer's callback is the one way to pace a stream in both workerd and node
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

// the reply's events, ended by the client going as a connection's would be
const streamOf = (plan: StreamPlan, signal: AbortSignal): ReadableStream<Uint8Array> => {
  let ended = false;
  return new ReadableStream<Uint8Array>({
    cancel() {
      ended = true;
    },
    async start(controller) {
      signal.addEventListener("abort", () => {
        if (!ended) {
          ended = true;
          controller.error(signal.reason);
        }
      });
      for (const [at, event] of plan.events.entries()) {
        if (ended || (plan.holdAfter !== null && at > plan.holdAfter)) {
          // held open with nothing more, until the client goes
          return;
        }
        if (plan.delayMs > 0) {
          await pause(plan.delayMs);
        }
        if (!ended) {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        }
      }
      ended = true;
      controller.close();
    },
  });
};

// the person's words the request carries, or its last compaction kept, which its script is read
// from
const scriptOfRequest = (request: FakeRequest) => scriptOf(conversationOf(request).person);

export const messagesFake = (): MessagesFake => {
  let requests = 0;
  let drops = 0;
  let held = 0;
  // per request body: how often a `fail` answered it, and whether a stall held it
  const failed = new Map<string, number>();
  const stalled = new Set<string>();

  const answer = async (incoming: Request): Promise<Response> => {
    requests += 1;
    const requestId = `req_fake_${String(requests)}`;
    if (incoming.headers.get("cf-aig-authorization") === null) {
      return failure(401, "AI Gateway: the request carries no cf-aig-authorization.", requestId);
    }
    const raw = await incoming.text();
    const parsed = parsedBody(raw);
    if (parsed === null) {
      return failure(400, "The request body is not JSON.", requestId);
    }
    if (!parsed.success) {
      return failure(400, issueText(parsed.error), requestId);
    }
    const request = parsed.data;
    if (request.model !== FAKE_MODEL) {
      return failure(404, `model: ${request.model}`, requestId);
    }
    if (request.stream !== true) {
      return failure(400, "The fake answers a streamed request alone.", requestId);
    }
    const betas = new Set(
      (incoming.headers.get("anthropic-beta") ?? "").split(",").map((beta) => beta.trim()),
    );
    const refused = requestRefusal(request, betas);
    if (refused !== null) {
      return failure(400, refused, requestId);
    }
    const thinking = await checkThinking(request);
    const dropping = request.thinking?.block_binding?.prefix_mismatch_behavior === "drop_block";
    const [firstFailed] = thinking.failed;
    if (firstFailed !== undefined && !dropping) {
      return failure(
        400,
        `${firstFailed}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding.prefix_mismatch_behavior\` to "drop_block".`,
        requestId,
      );
    }
    drops += thinking.failed.length;
    const hash = await bodyHash(raw);
    const { fail } = scriptOfRequest(request);
    const times = failed.get(hash) ?? 0;
    if (fail !== null && times < fail.times) {
      failed.set(hash, times + 1);
      return failure(
        fail.status,
        `The fake answered ${String(fail.status)}, as its script asked.`,
        requestId,
      );
    }
    const plan = await planReply(request, {
      dropped: betas.has(BINDING_BETA) ? thinking.failed : null,
      holds: () => {
        if (stalled.has(hash)) {
          return false;
        }
        stalled.add(hash);
        held += 1;
        return true;
      },
      id: `msg_fake_${String(requests)}`,
      iterating: betas.has(COMPACT_BETA),
      previousSignature: thinking.last,
      toolIdPrefix: `toolu_fake_${hash.slice(0, 16)}`,
    });
    return new Response(streamOf(plan, incoming.signal), {
      headers: { "content-type": "text/event-stream", "request-id": requestId },
      status: 200,
    });
  };

  return {
    fetch: async (input, init) => {
      const incoming = new Request(input, init);
      const { pathname } = new URL(incoming.url);
      if (incoming.method === "GET" && pathname === FAKE_STATS_PATH) {
        return Response.json({ drops, held, requests } satisfies FakeStats);
      }
      if (incoming.method === "POST" && MESSAGES_PATH.test(pathname)) {
        return await answer(incoming);
      }
      return Response.json(
        {
          error: {
            message: `The fake answers no ${incoming.method} ${pathname}.`,
            type: "not_found_error",
          },
          type: "error",
        },
        { status: 404 },
      );
    },
    stats: () => ({ drops, held, requests }),
  };
};
