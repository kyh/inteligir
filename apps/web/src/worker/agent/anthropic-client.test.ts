// The built-in agent's Messages client: built from the deployment's bindings alone, it reaches
// Claude through the target's AI Gateway with the gateway's token and no Anthropic key, asks the
// gateway to keep no payload, names the scripted API only on this machine, and with neither is no
// client at all, so a send is refused rather than faked.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { agentConfigured, anthropicClient } from "./anthropic-client";
import { AGENT_BETAS } from "./thread-request";

// a deployment with neither the scripted API nor a gateway: CI's build, or a target not yet set up
const bare: Env = {
  ...env,
  AGENT_GATEWAY_URL: "",
  AI_GATEWAY_TOKEN: "",
  ANTHROPIC_FAKE_URL: undefined,
};

const GATEWAY =
  "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/inteligir/anthropic";

const reply = {
  content: [{ citations: null, text: "Hello.", type: "text" }],
  id: "msg_1",
  model: "claude-opus-5-5",
  role: "assistant",
  stop_reason: "end_turn",
  stop_sequence: null,
  type: "message",
  usage: { input_tokens: 1, output_tokens: 1 },
};

describe("the built-in agent's client", () => {
  it("is none with neither the scripted API nor a gateway and its token, so the agent is off", () => {
    expect(anthropicClient(bare)).toBeNull();
    expect(agentConfigured(bare)).toBe(false);
    // a gateway without its token, or a token without its gateway, is none either
    expect(anthropicClient({ ...bare, AGENT_GATEWAY_URL: GATEWAY })).toBeNull();
    expect(anthropicClient({ ...bare, AI_GATEWAY_TOKEN: "gateway-token" })).toBeNull();
    expect(agentConfigured({ ...bare, AGENT_GATEWAY_URL: GATEWAY, AI_GATEWAY_TOKEN: "t" })).toBe(
      true,
    );
  });

  it("refuses a scripted API anywhere but this machine", () => {
    for (const url of ["http://example.com:5177", "http://10.0.0.7:5177"]) {
      expect(() => anthropicClient({ ...bare, ANTHROPIC_FAKE_URL: url }), url).toThrow(
        "ANTHROPIC_FAKE_URL names this machine alone",
      );
    }
    // the scripted API speaks plain http, so an https address names no fake
    expect(() => anthropicClient({ ...bare, ANTHROPIC_FAKE_URL: "https://127.0.0.1" })).toThrow(
      "Invalid URL",
    );
    expect(agentConfigured({ ...bare, ANTHROPIC_FAKE_URL: "http://localhost:5177" })).toBe(true);
  });

  it("sends the gateway's token and asks it to keep no payload, and sends no Anthropic key", async () => {
    const sent: Request[] = [];
    const client = anthropicClient(
      { ...bare, AGENT_GATEWAY_URL: GATEWAY, AI_GATEWAY_TOKEN: "gateway-token" },
      async (input, init) => {
        sent.push(new Request(input, init));
        return await Promise.resolve(Response.json(reply));
      },
    );
    if (client === null) {
      throw new Error("a gateway and its token make a client");
    }
    const message = await client.beta.messages.create({
      betas: [...AGENT_BETAS],
      max_tokens: 16,
      messages: [{ content: "Hello.", role: "user" }],
      model: "claude-opus-5-5",
    });
    expect(message.content).toStrictEqual(reply.content);
    const [request] = sent;
    expect(request?.url).toBe(`${GATEWAY}/v1/messages`);
    expect(request?.headers.get("cf-aig-authorization")).toBe("Bearer gateway-token");
    expect(request?.headers.get("cf-aig-collect-log-payload")).toBe("false");
    expect(request?.headers.get("x-api-key")).toBeNull();
    expect(request?.headers.get("authorization")).toBeNull();
    expect(request?.headers.get("anthropic-beta")).toBe(AGENT_BETAS.join(","));
  });

  it("asks once, since the thread sends a cut or failed call again itself, whole", async () => {
    let asked = 0;
    const client = anthropicClient(
      { ...bare, AGENT_GATEWAY_URL: GATEWAY, AI_GATEWAY_TOKEN: "gateway-token" },
      async () => {
        asked += 1;
        return await Promise.resolve(
          Response.json(
            { error: { message: "Overloaded", type: "overloaded_error" }, type: "error" },
            { status: 529 },
          ),
        );
      },
    );
    await expect(
      client?.messages.create({
        max_tokens: 16,
        messages: [{ content: "Hello.", role: "user" }],
        model: "claude-opus-5-5",
      }),
    ).rejects.toMatchObject({ status: 529 });
    expect(asked).toBe(1);
  });
});
