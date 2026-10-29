// Anthropic's webhook as the Worker answers it: a body whose Standard Webhooks signature does not
// verify under the deployment's key is refused; one that does is answered at once and routed, a
// session's idle to the cell its metadata names, which reconciles the turn its stream never read,
// a credential's failed refresh to the cell its vault names, which repairs it; and a delivery
// Anthropic sends again routes nothing more.

import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { connectorAuth } from "../connector/connector-auth";
import { openCellLibrary } from "../library/cell-library";
import { agentOn, storedTypes, threadStatus, turnOpen, valueOf } from "../test-support/agent-turns";
import { ORIGIN } from "../test-support/cloud-helpers";
import { workerFetch } from "../test-support/connector-session";
import { cellOf, inCell, newAccountId } from "../test-support/library-cell";
import {
  fakeManagedAgentsApi,
  servedAgents,
  serveInProcess,
} from "../test-support/managed-agents-api";
import { TEST_WEBHOOK_SIGNING_KEY } from "../test-support/test-origin";
import { ANTHROPIC_WEBHOOK_PATH } from "./anthropic-webhook";
import { sessionAgent } from "./session-agent";
import {
  createThread,
  holdSession,
  setThreadSession,
  setTurnRunning,
  setTurnSession,
} from "./turn-rows";
import { claimTurn } from "./turn-state";

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

// the headers a delivery carries, signed as Standard Webhooks signs one: HMAC-SHA256 under the
// key's bytes over its id, its time and its body
const signed = async (
  body: string,
  id: string,
  key = TEST_WEBHOOK_SIGNING_KEY,
): Promise<Record<string, string>> => {
  const at = String(Math.floor(Date.now() / 1000));
  const hmac = await crypto.subtle.importKey(
    "raw",
    bytesOf(key.slice("whsec_".length)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmac,
    new TextEncoder().encode(`${id}.${at}.${body}`),
  );
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-signature": `v1,${btoa(String.fromCodePoint(...new Uint8Array(signature)))}`,
    "webhook-timestamp": at,
  };
};

const delivery = (id: string, data: Record<string, string>): string =>
  JSON.stringify({
    created_at: new Date().toISOString(),
    data: { organization_id: "org_test", workspace_id: "wrkspc_test", ...data },
    id,
    type: "event",
  });

const post = async (body: string, headers: Record<string, string>): Promise<Response> =>
  await workerFetch(`${ORIGIN}${ANTHROPIC_WEBHOOK_PATH}`, { body, headers, method: "POST" });

const listings = (calls: readonly { readonly method: string; readonly path: string }[]) =>
  calls.filter((call) => call.method === "GET" && call.path.endsWith("/events")).length;

describe("Anthropic's webhook", () => {
  it("refuses a delivery whose signature does not verify, and any but a POST", async () => {
    const body = delivery("wevt_forged", { id: "sesn_x", type: "session.status_idled" });
    const forged = await post(
      body,
      await signed(body, "wevt_forged", `whsec_${btoa("k".repeat(32))}`),
    );
    expect(forged.status).toBe(400);
    await forged.arrayBuffer();
    const unsigned = await post(body, { "content-type": "application/json" });
    expect(unsigned.status).toBe(400);
    await unsigned.arrayBuffer();
    const read = await workerFetch(`${ORIGIN}${ANTHROPIC_WEBHOOK_PATH}`);
    expect(read.status).toBe(405);
    await read.arrayBuffer();
  });

  it(
    "routes a session's idle to the cell its metadata names, which reconciles the turn, once a delivery",
    { timeout: 30_000 },
    async () => {
      const api = fakeManagedAgentsApi();
      const stopServing = serveInProcess(api);
      try {
        const accountId = newAccountId();
        const threadId = crypto.randomUUID();
        const agents = servedAgents();
        // a turn the cell started and whose stream it never read, as one an evicted cell left
        const session = await agents.client.beta.sessions.create({
          agent: sessionAgent(agents.agent, connectorAuth(env).origin),
          environment_id: agents.environmentId,
          initial_events: [{ content: [{ text: "Hello.", type: "text" }], type: "user.message" }],
          metadata: { accountId, threadId },
        });
        await api.settled();
        await inCell(cellOf(accountId), (state) => {
          valueOf(
            openCellLibrary(state, env).landApart(
              { answer: z.literal(true), opId: undefined },
              (scope) => {
                createThread(scope, threadId, "Hello.");
                claimTurn(scope, { message: { text: "Hello.", viewContext: null }, threadId });
                holdSession(scope, session.id, threadId);
                setThreadSession(scope, threadId, session.id);
                setTurnSession(scope.storage, session.id);
                setTurnRunning(scope.storage);
                return true as const;
              },
            ),
          );
        });
        const body = delivery("wevt_idled", { id: session.id, type: "session.status_idled" });
        const answered = await post(body, await signed(body, "wevt_idled"));
        expect(answered.status).toBe(200);
        await vi.waitFor(
          async () => {
            const sealed = await inCell(cellOf(accountId), (state) => ({
              open: turnOpen(state),
              status: threadStatus(state, threadId),
              types: storedTypes(state, threadId),
            }));
            expect(sealed).toEqual({
              open: false,
              status: "idle",
              types: expect.arrayContaining([
                "user.message",
                "agent.message",
                "session.status_idle",
              ]),
            });
          },
          { interval: 50, timeout: 20_000 },
        );
        // Anthropic's second try of the same delivery reconciles nothing more
        const listed = listings(api.calls);
        const again = await post(body, await signed(body, "wevt_idled"));
        expect(again.status).toBe(200);
        await vi.waitFor(() => {
          expect(api.calls.at(-1)?.path).toBe(`/v1/sessions/${session.id}`);
        });
        expect(listings(api.calls)).toBe(listed);
      } finally {
        stopServing();
      }
    },
  );

  it(
    "routes a failed refresh to the cell its vault names, which has Anthropic judge the credential",
    { timeout: 30_000 },
    async () => {
      const api = fakeManagedAgentsApi();
      const stopServing = serveInProcess(api);
      try {
        const accountId = newAccountId();
        await inCell(cellOf(accountId), async (state) => {
          await agentOn(state, { agents: servedAgents(), api });
        });
        const [vaultId] = api.vaults.keys();
        const [credentialId] = api.credentials.keys();
        const body = delivery("wevt_refresh", {
          id: credentialId ?? "",
          type: "vault_credential.refresh_failed",
          vault_id: vaultId ?? "",
        });
        const answered = await post(body, await signed(body, "wevt_refresh"));
        expect(answered.status).toBe(200);
        await vi.waitFor(() => {
          expect(api.calls.map((call) => call.path)).toContain(
            `/v1/vaults/${vaultId ?? ""}/credentials/${credentialId ?? ""}/mcp_oauth_validate`,
          );
        });
      } finally {
        stopServing();
      }
    },
  );
});
