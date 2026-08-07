// ---------------------------------------------------------------------------
// The editor's AI: the two provider wire formats, and the lane bounds that keep
// a per-keystroke feature from keeping a Durable Object resident.
//
// The wire half is driven as pure functions — that is the whole reason it is
// pure — and the generator half is driven through the REAL handlers over the
// object's own composition, on the catalog's no-account provider. Nothing here
// is a stand-in for the generator: the bounds, the supersede semantics and the
// streamed-delta emission are the production ones.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  buildCompletionRequest,
  completionHeaders,
  drainSseEvents,
  readCompletionText,
  readStreamDelta,
} from "../ai/provider-wire";
import {
  allProviders,
  chooseProvider,
  providerEntry,
  type ProviderEnv,
} from "../agent/provider-catalog";
import { userHostName } from "../host/host-address";

function entry(id: string) {
  const found = providerEntry(id);
  if (found === null) throw new Error(`no provider called ${id}`);
  return found;
}

const ANTHROPIC = entry("anthropic");
const OPENAI = entry("openai");

describe("provider wire", () => {
  it("builds each provider's completion request at its own path", () => {
    const params = { modelId: "m", prompt: "hello", maxTokens: 16, stream: false };
    const claude = buildCompletionRequest(ANTHROPIC, params);
    expect(claude.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(claude.body)).toEqual({
      model: "m",
      max_tokens: 16,
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });

    const openai = buildCompletionRequest(OPENAI, params);
    expect(openai.url).toBe("https://api.openai.com/v1/chat/completions");
    // `max_completion_tokens`, never the deprecated `max_tokens`: the
    // reasoning-model families reject the old name outright.
    expect(JSON.parse(openai.body)).toEqual({
      model: "m",
      max_completion_tokens: 16,
      stream: false,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("carries the credential on the entry's own header, plus its extra headers", () => {
    const claude = completionHeaders(ANTHROPIC, "token-1");
    expect(claude.get("authorization")).toBe("Bearer token-1");
    expect(claude.get("anthropic-version")).toBe("2023-06-01");
    expect(completionHeaders(OPENAI, "token-2").get("authorization")).toBe("Bearer token-2");
  });

  it("reads the assistant text out of each reply shape", () => {
    expect(
      readCompletionText(ANTHROPIC, {
        content: [
          { type: "text", text: "one " },
          { type: "thinking" },
          { type: "text", text: "two" },
        ],
      }),
    ).toBe("one two");
    expect(readCompletionText(OPENAI, { choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });

  it("answers empty for a reply that carried no text, rather than throwing", () => {
    // A refusal block, a tool call or a stop-reason-only body is not a
    // transport failure — the caller already has a "no response" sentence.
    expect(readCompletionText(ANTHROPIC, { content: [{ type: "tool_use" }] })).toBe("");
    expect(readCompletionText(OPENAI, { choices: [] })).toBe("");
    expect(readCompletionText(OPENAI, "not an object")).toBe("");
  });

  it("reads a text delta out of each stream event, ignoring the rest", () => {
    expect(
      readStreamDelta(
        ANTHROPIC,
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "ab" } }),
      ),
    ).toBe("ab");
    expect(readStreamDelta(ANTHROPIC, JSON.stringify({ type: "message_start" }))).toBe("");
    expect(
      readStreamDelta(OPENAI, JSON.stringify({ choices: [{ delta: { content: "cd" } }] })),
    ).toBe("cd");
    expect(readStreamDelta(OPENAI, "[DONE]")).toBe("");
    expect(readStreamDelta(OPENAI, "{ not json")).toBe("");
  });

  it("keeps a half-arrived SSE event as the remainder instead of dropping it", () => {
    // A chunked read splits mid-event constantly; a swallowed tail is a
    // completion missing its last words.
    const first = drainSseEvents('data: {"a":1}\n\ndata: {"b":');
    expect(first.events).toEqual(['{"a":1}']);
    expect(first.rest).toBe('data: {"b":');

    const second = drainSseEvents(`${first.rest}2}\n\n`);
    expect(second.events).toEqual(['{"b":2}']);
    expect(second.rest).toBe("");
  });

  it("reads CRLF frames and multi-line data fields", () => {
    const drained = drainSseEvents('event: x\r\ndata: {"a":\r\ndata: 1}\r\n\r\n');
    expect(drained.events).toEqual(['{"a":1}']);
  });
});

describe("provider choice", () => {
  // Whole deployment configurations, STATED rather than inherited: a provider
  // is offered only when its entire OAuth trio is set, and `sandbox` only where
  // the real runtime is not. Passing the ambient env would make "offers
  // nothing" mean "nothing is in the developer's .dev.vars".
  const BOTH_REAL: ProviderEnv = {
    ANTHROPIC_OAUTH_AUTHORIZE_URL: "https://auth.example/a",
    ANTHROPIC_OAUTH_TOKEN_URL: "https://auth.example/at",
    ANTHROPIC_OAUTH_CLIENT_ID: "a",
    OPENAI_OAUTH_AUTHORIZE_URL: "https://auth.example/o",
    OPENAI_OAUTH_TOKEN_URL: "https://auth.example/ot",
    OPENAI_OAUTH_CLIENT_ID: "o",
  };

  it("resolves an unset selection to what Settings shows, not to a refusal", () => {
    // The regression this pins: Settings normalized a null selection to the
    // first offered provider while a turn read the stored null and refused — so
    // a fresh account was SHOWN a provider and then told none was chosen the
    // moment it sent a message.
    expect(chooseProvider(BOTH_REAL, null, () => true)).toEqual({
      ok: true,
      entry: ANTHROPIC,
      modelId: ANTHROPIC.defaultModelId,
    });
  });

  it("falls back off a provider this deployment stopped offering", () => {
    const { ANTHROPIC_OAUTH_CLIENT_ID: _dropped, ...withoutAnthropic } = BOTH_REAL;
    expect(
      chooseProvider(withoutAnthropic, { provider: "anthropic", modelId: "x" }, () => true),
    ).toEqual({ ok: true, entry: OPENAI, modelId: OPENAI.defaultModelId });
  });

  it("offers the no-account provider only on the scripted runtime", () => {
    const choice = chooseProvider({ AGENT_RUNTIME: "scripted" }, null, () => true);
    expect(choice.ok && choice.entry.requiresAuth).toBe(false);
  });

  it("names the one sentence every surface refuses with", () => {
    expect(chooseProvider(BOTH_REAL, { provider: "anthropic", modelId: "x" }, () => false)).toEqual(
      {
        ok: false,
        error: "Claude is not connected. Connect it in Settings → AI.",
      },
    );
  });

  it("refuses a deployment that offers nothing at all", () => {
    // No OAuth trio and the REAL runtime, so `sandbox` is not offered either.
    expect(chooseProvider({}, null, () => true)).toEqual({
      ok: false,
      error: "No AI provider is configured on this deployment.",
    });
  });

  it("falls back to the provider's default when the stored model is gone", () => {
    expect(chooseProvider(BOTH_REAL, { provider: "openai", modelId: "gpt-3" }, () => true)).toEqual(
      { ok: true, entry: OPENAI, modelId: OPENAI.defaultModelId },
    );
  });
});

describe("the catalog's fast tier", () => {
  it("names a model the provider actually offers", () => {
    // The ghost lane and the intent classifier both run on it, so a fastModelId
    // the catalog does not list would be a 404 per keystroke.
    for (const provider of allProviders()) {
      expect(provider.models.map((model) => model.id)).toContain(provider.fastModelId);
      expect(provider.models.map((model) => model.id)).toContain(provider.defaultModelId);
    }
  });
});

/** Drive the object's own generator, which is what the handlers reach. */
function withGenerator<T>(
  run: (host: {
    ai: InstanceType<typeof import("../ai/text-generator").TextGenerator>;
  }) => Promise<T>,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName("editor-ai-fixture"));
  return runInDurableObject(stub, async (host) => {
    // The no-account provider: the catalog's scripted entry, offered exactly
    // where there is no real container — which is how this whole suite runs.
    host.agent.credentials.setSelection({ provider: "sandbox", modelId: "sandbox-1" });
    return run(host);
  });
}

describe("the generator", () => {
  it("streams its deltas and answers the same text", async () => {
    await withGenerator(async (host) => {
      const result = await host.ai.generate("Write a haiku about tests", "req-1");
      expect(result).toEqual({ ok: true, text: "[scripted] Write a haiku about tests" });
    });
  });

  it("supersedes the previous request in a lane rather than queueing behind it", async () => {
    await withGenerator(async (host) => {
      // Two ghost requests in flight is the case the bound exists for: a
      // keystroke invalidates the completion before it lands, and the pin on
      // this object has to end with it.
      const first = host.ai.ghost("one", "ghost-1");
      const second = host.ai.ghost("two", "ghost-2");
      expect(await second).toEqual({ ok: true, text: "[scripted] two" });
      await first;
    });
  });

  it("classifies through the fast lane and falls back to generate", async () => {
    await withGenerator(async (host) => {
      // The scripted provider echoes the prompt, which contains both words —
      // `parseAiIntent` resolves an ambiguous answer to the non-destructive
      // branch.
      expect(await host.ai.classify("rewrite this", true)).toEqual({ intent: "generate" });
    });
  });

  it("lists the selected provider's models with the declared fast tier default", async () => {
    await withGenerator(async (host) => {
      expect(host.ai.ghostModels()).toEqual({
        models: [{ id: "sandbox-1", label: "Scripted" }],
        defaultId: "sandbox-1",
      });
    });
  });

  it("refuses with the provider sentence when nothing is connected", async () => {
    const stub = env.UserHost.getByName(userHostName("editor-ai-unconnected"));
    await runInDurableObject(stub, async (host) => {
      host.agent.credentials.setSelection({ provider: "anthropic", modelId: "claude-sonnet-5" });
      expect(await host.ai.generate("hello", "req-x")).toEqual({
        ok: false,
        error: "Claude is not connected. Connect it in Settings → AI.",
      });
      expect(host.ai.ghostModels()).toEqual({ models: [], defaultId: null });
    });
  });
});
