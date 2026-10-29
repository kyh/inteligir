// A Managed Agents API in the shapes its reference records, handed to the SDK as its `fetch`, so
// a suite drives the real client with no model and no account
// (platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript#customizing-the-fetch-client):
// it keeps the vaults, credentials and sessions the calls made, answers each call as the API
// would, and records every request it was sent.

import { env } from "cloudflare:workers";
import { z } from "zod";

import { managedAgents } from "../agent/managed-agents";
import type { ManagedAgents } from "../agent/managed-agents";

interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

type Validation = "invalid" | "unknown" | "valid";

const NOW = "2026-10-29T00:00:00Z";

const vaultBodySchema = z.looseObject({
  metadata: z.record(z.string(), z.string()).default({}),
});

const credentialBodySchema = z.looseObject({
  auth: z.looseObject({ refresh: z.looseObject({}).optional(), type: z.literal("mcp_oauth") }),
});

type CredentialAuth = z.infer<typeof credentialBodySchema>["auth"];

interface HeldCredential {
  readonly vaultId: string;
  readonly auth: CredentialAuth;
}

const refusal = (status: number, type: string, message: string): Response =>
  Response.json({ error: { message, type }, type: "error" }, { status });

const credentialRecord = (id: string, held: HeldCredential) => ({
  archived_at: null,
  auth: held.auth,
  created_at: NOW,
  display_name: "Inteligir library",
  id,
  metadata: {},
  type: "vault_credential",
  updated_at: NOW,
  vault_id: held.vaultId,
});

const parsedBody = <T>(schema: z.ZodType<T>, text: string): T =>
  schema.parse(text === "" ? null : JSON.parse(text));

export const fakeManagedAgentsApi = () => {
  const calls: RecordedCall[] = [];
  const vaults = new Map<string, Record<string, string>>();
  const credentials = new Map<string, HeldCredential>();
  const sessions = new Map<string, { status: string }>();
  // what a validation answers, as the API would after its probe and any refresh it tried
  let validation: Validation = "valid";
  // the next call that matches answers as the API does when it fails
  let failing: { readonly method: string; readonly path: RegExp } | null = null;
  let minted = 0;
  const mint = (prefix: string): string => {
    minted += 1;
    return `${prefix}_011CZ${String(minted).padStart(4, "0")}`;
  };

  const createVault = (text: string): Response => {
    const id = mint("vlt");
    const { metadata } = parsedBody(vaultBodySchema, text);
    vaults.set(id, metadata);
    return Response.json({
      archived_at: null,
      created_at: NOW,
      display_name: "Inteligir library",
      id,
      metadata,
      type: "vault",
      updated_at: NOW,
    });
  };

  const deleteVault = (vaultId: string): Response => {
    if (!vaults.delete(vaultId)) {
      return refusal(404, "not_found_error", "vault not found");
    }
    for (const [id, held] of credentials) {
      if (held.vaultId === vaultId) {
        credentials.delete(id);
      }
    }
    return Response.json({ id: vaultId, type: "vault_deleted" });
  };

  const createCredential = (vaultId: string, text: string): Response => {
    if (!vaults.has(vaultId)) {
      return refusal(404, "not_found_error", "vault not found");
    }
    const { auth } = parsedBody(credentialBodySchema, text);
    const id = mint("vcrd");
    credentials.set(id, { auth, vaultId });
    return Response.json(credentialRecord(id, { auth, vaultId }));
  };

  const heldIn = (vaultId: string, id: string): HeldCredential | null => {
    const held = credentials.get(id);
    return held?.vaultId === vaultId ? held : null;
  };

  const updateCredential = (vaultId: string, id: string, text: string): Response => {
    const held = heldIn(vaultId, id);
    if (held === null) {
      return refusal(404, "not_found_error", "credential not found");
    }
    const { auth } = parsedBody(credentialBodySchema, text);
    // a field the update leaves out keeps its value, the refresh block's included, as the API
    // merges an update
    const refresh =
      auth.refresh === undefined ? held.auth.refresh : { ...held.auth.refresh, ...auth.refresh };
    const updated = { auth: { ...held.auth, ...auth, refresh }, vaultId };
    credentials.set(id, updated);
    return Response.json(credentialRecord(id, updated));
  };

  const validateCredential = (vaultId: string, id: string): Response =>
    heldIn(vaultId, id) === null
      ? refusal(404, "not_found_error", "credential not found")
      : Response.json({
          credential_id: id,
          has_refresh_token: true,
          mcp_probe: null,
          refresh: null,
          status: validation,
          type: "vault_credential_validation",
          validated_at: NOW,
          vault_id: vaultId,
        });

  const sessionAt = (sessionId: string, answer: (held: { status: string }) => Response) => {
    const held = sessions.get(sessionId);
    return held === undefined ? refusal(404, "not_found_error", "session not found") : answer(held);
  };

  const routes: readonly {
    readonly method: string;
    readonly path: RegExp;
    readonly answer: (ids: Readonly<Record<string, string>>, body: string) => Response;
  }[] = [
    { answer: (_, body) => createVault(body), method: "POST", path: /^\/v1\/vaults$/u },
    {
      answer: ({ vault = "" }) => deleteVault(vault),
      method: "DELETE",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)$/u,
    },
    {
      answer: ({ vault = "" }, body) => createCredential(vault, body),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials$/u,
    },
    {
      answer: ({ credential = "", vault = "" }) => validateCredential(vault, credential),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials\/(?<credential>[^/]+)\/mcp_oauth_validate$/u,
    },
    {
      answer: ({ credential = "", vault = "" }, body) => updateCredential(vault, credential, body),
      method: "POST",
      path: /^\/v1\/vaults\/(?<vault>[^/]+)\/credentials\/(?<credential>[^/]+)$/u,
    },
    {
      answer: ({ session = "" }) =>
        sessionAt(session, (held) =>
          Response.json({ id: session, status: held.status, type: "session" }),
        ),
      method: "GET",
      path: /^\/v1\/sessions\/(?<session>[^/]+)$/u,
    },
    {
      // an interrupt settles the session at once here; the API settles it a moment later
      answer: ({ session = "" }) =>
        sessionAt(session, (held) => {
          held.status = "idle";
          return Response.json({ data: [] });
        }),
      method: "POST",
      path: /^\/v1\/sessions\/(?<session>[^/]+)\/events$/u,
    },
    {
      answer: ({ session = "" }) =>
        sessionAt(session, (held) => {
          if (held.status === "running") {
            return refusal(400, "invalid_request_error", "the session is running");
          }
          sessions.delete(session);
          return Response.json({ id: session, type: "session_deleted" });
        }),
      method: "DELETE",
      path: /^\/v1\/sessions\/(?<session>[^/]+)$/u,
    },
  ];

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    const body = await request.text();
    calls.push({ body, headers: request.headers, method: request.method, path: pathname });
    if (failing?.method === request.method && failing.path.test(pathname)) {
      failing = null;
      // marked as one no retry mends, so the SDK hands it straight back
      const failed = refusal(500, "api_error", "Internal server error");
      failed.headers.set("x-should-retry", "false");
      return failed;
    }
    for (const route of routes) {
      const matched = route.method === request.method ? route.path.exec(pathname) : null;
      if (matched !== null) {
        return route.answer(matched.groups ?? {}, body);
      }
    }
    return refusal(404, "not_found_error", `${request.method} ${pathname}`);
  };

  return {
    calls,
    credentials,
    failNext: (method: string, path: RegExp): void => {
      failing = { method, path };
    },
    fetch,
    // a session one of the account's threads holds
    holdSession: (status: string): string => {
      const id = mint("sesn");
      sessions.set(id, { status });
      return id;
    },
    sessions,
    validateAs: (status: Validation): void => {
      validation = status;
    },
    vaults,
  };
};

// what a deployment whose agent was applied, and whose key is set, binds: the ids its lockfile
// recorded and its secret
export const deployedEnv: Env = {
  ...env,
  AGENT_ENVIRONMENT_ID: "env_011CZkZ9",
  AGENT_ID: "agent_011CZkZ8",
  AGENT_VERSION: "3",
  ANTHROPIC_API_KEY: "sk-ant-test",
};

// a deployment's client over the recorded API
export const managedAgentsOver = (api: { readonly fetch: typeof fetch }): ManagedAgents => {
  const agents = managedAgents(deployedEnv, api.fetch);
  if (agents === null) {
    throw new Error("a deployment with a key and an applied agent has a client");
  }
  return agents;
};
