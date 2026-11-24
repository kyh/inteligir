import { oauthAccessToken } from "@repo/db/auth-schema";
import { db } from "@repo/db/drizzle-client";
import { dbSuite } from "@repo/db/test-database";
import { walkProcedureContractsSync } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { listAssistants, revokeAssistant } from "../auth/connected-assistants";
import {
  CONNECTOR_RESOURCE,
  CONNECTOR_RESOURCE_METADATA_URL,
  hashOAuthToken,
  OAUTH_TOKEN_PREFIX,
} from "../auth/oauth-auth";
import { TAGGED_ROWS } from "../library/library-tools";
import { libraryRouter } from "../rpc/library-router";
import { CONNECTOR_SKILLS, connectorSkillCatalog } from "./connector-skills";
import { authPost, ORIGIN, signUpUser, userIdOf } from "../test-support/auth-requests.test-utils";
import {
  connectAssistant,
  connectorFetch,
  dpopKey,
  refreshTokens,
  rpc,
  tokensOf,
} from "../test-support/connector-grants.test-utils";
import { issueToken } from "../test-support/password-reset.test-utils";

const FULL = "library:read library offline_access";
const READ_ONLY = "library:read offline_access";

const errorSchema = z.object({ error: z.object({ message: z.string() }) });

const listedSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        annotations: z.object({ openWorldHint: z.boolean(), title: z.string() }),
        inputSchema: z.object({ type: z.literal("object") }),
        name: z.string(),
      }),
    ),
  }),
});

const calledSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string(), type: z.literal("text") })),
    isError: z.boolean().optional(),
    structuredContent: z.json().optional(),
  }),
});

const ROUTED_TOOLS = (() => {
  const routed = new Set<string>();
  walkProcedureContractsSync(libraryRouter, (_row, path) => {
    routed.add(path.join("."));
  });

  return TAGGED_ROWS.flatMap(({ path, tool }) =>
    routed.has(path.join(".")) && tool.name !== undefined
      ? [{ name: tool.name, reads: tool.annotations?.readOnlyHint === true }]
      : [],
  );
})();

const signedUp = async (email: string) => {
  const { cookie } = await signUpUser(email);

  return { cookie, userId: await userIdOf(cookie) };
};

const listTools = async (bearer: string) => {
  const response = await connectorFetch({ bearer, body: rpc("tools/list") });
  expect(response.status).toBe(200);

  return listedSchema.parse(await response.json()).result.tools.map(({ name }) => name);
};

const callTool = async (bearer: string, name: string, args: Record<string, string> = {}) => {
  const response = await connectorFetch({
    bearer,
    body: rpc("tools/call", { arguments: args, name }),
  });

  expect(response.status).toBe(200);

  return calledSchema.parse(await response.json()).result;
};

dbSuite("the connector", () => {
  describe("before a token", () => {
    it("refuses a page of another site before it reads anything", async () => {
      const response = await connectorFetch({
        body: rpc("tools/list"),
        headers: { origin: "https://evil.example" },
      });

      expect(response.status).toBe(403);
    });

    it("challenges a call with no token, naming its metadata and every scope", async () => {
      const response = await connectorFetch({ body: rpc("initialize") });
      expect(response.status).toBe(401);
      const challenge = response.headers.get("www-authenticate") ?? "";
      expect(challenge).toMatch(/^Bearer /u);
      expect(challenge).toContain(`resource_metadata="${CONNECTOR_RESOURCE_METADATA_URL}"`);
      expect(challenge).toContain('scope="library:read library offline_access"');
      expect(challenge).not.toContain("error=");
      errorSchema.parse(await response.json());
    });

    it("challenges a token it never minted as invalid", async () => {
      for (const bearer of ["not-a-token", `${OAUTH_TOKEN_PREFIX}forged`]) {
        const response = await connectorFetch({ bearer, body: rpc("tools/list") });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
      }
    });

    it("takes no session of the person's own", async () => {
      const { cookie } = await signedUp("connector-session@example.com");
      const response = await connectorFetch({ body: rpc("tools/list"), headers: { cookie } });
      expect(response.status).toBe(401);
    });
  });

  it("lists every tool to a grant that changes the library and calls one as the assistant", async () => {
    const { cookie, userId } = await signedUp("connector-full@example.com");
    const { tokens } = await connectAssistant("Claude", { allowed: FULL, cookie, scope: FULL });
    expect(tokens.access_token.startsWith(OAUTH_TOKEN_PREFIX)).toBe(true);
    expect(tokens.scope.split(" ").toSorted()).toStrictEqual(FULL.split(" ").toSorted());

    const names = await listTools(tokens.access_token);
    expect(names.toSorted()).toStrictEqual(ROUTED_TOOLS.map(({ name }) => name).toSorted());
    expect(names).toContain("read_guide");

    const guide = await callTool(tokens.access_token, "read_guide");
    expect(guide.structuredContent).toMatchObject({
      markdown: expect.stringContaining("::::tabs"),
    });

    const created = await callTool(tokens.access_token, "create_note", {
      markdown: "The quick brown fox.",
      title: "Fox notes",
    });

    expect(created.isError).not.toBe(true);

    const { item } = z
      .object({ item: z.object({ id: z.string() }) })
      .parse(created.structuredContent);

    const found = await callTool(tokens.access_token, "search_library", { query: "quick fox" });
    expect(found.structuredContent).toMatchObject({ hits: [{ id: item.id }] });

    const refused = await callTool(tokens.access_token, "read_item", { id: "not-an-id" });
    expect(refused.isError).toBe(true);

    expect(await listAssistants(userId)).toMatchObject([
      { clientName: "Claude", scopes: ["library:read", "library"] },
    ]);
  });

  it("lists a grant that only reads the reads alone, and lets it change nothing", async () => {
    const { cookie } = await signedUp("connector-read@example.com");

    const { tokens } = await connectAssistant("ChatGPT", {
      allowed: READ_ONLY,
      cookie,
      scope: FULL,
    });

    const names = await listTools(tokens.access_token);
    expect(names.toSorted()).toStrictEqual(
      ROUTED_TOOLS.filter(({ reads }) => reads)
        .map(({ name }) => name)
        .toSorted(),
    );

    const write = await connectorFetch({
      bearer: tokens.access_token,
      body: rpc("tools/call", { arguments: { markdown: "Nope." }, name: "create_note" }),
    });

    expect(errorSchema.parse(await write.json()).error.message).toContain("create_note");
  });

  it("serves the writing guide as a skill, its files as resources, to any grant", async () => {
    const { cookie } = await signedUp("connector-skills@example.com");

    const { tokens } = await connectAssistant("Claude", {
      allowed: READ_ONLY,
      cookie,
      scope: FULL,
    });

    const bearer = tokens.access_token;

    const send = async (method: string, params: Parameters<typeof rpc>[1] = {}) => {
      const response = await connectorFetch({ bearer, body: rpc(method, params) });

      expect(response.status).toBe(200);

      return z.json().parse(await response.json());
    };

    const initialized = await send("initialize", {
      capabilities: {},
      clientInfo: { name: "Claude", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    });

    expect(initialized).toMatchObject({
      result: {
        capabilities: { extensions: { "io.modelcontextprotocol/skills": {} }, resources: {} },
      },
    });
    expect(await send("skills/list")).toStrictEqual({
      id: expect.any(Number),
      jsonrpc: "2.0",
      result: {
        cacheScope: "public",
        resultType: "complete",
        skills: await connectorSkillCatalog(),
        ttlMs: 3_600_000,
      },
    });
    expect(await send("skills/get", { uri: "skill://library-notes/SKILL.md" })).toMatchObject({
      result: { skill: { uri: "skill://library-notes/SKILL.md" } },
    });
    expect(await send("skills/get", { uri: "skill://nope/SKILL.md" })).toMatchObject({
      error: { code: -32_602 },
    });

    const canvas = CONNECTOR_SKILLS[0]?.files.find(({ path }) => path === "references/canvas.md");

    expect(
      await send("resources/read", { uri: "skill://library-notes/references/canvas.md" }),
    ).toMatchObject({ result: { contents: [{ mimeType: "text/markdown", text: canvas?.text }] } });
  });

  it("answers in its own protocol: one message a POST, no session to open or end", async () => {
    const { cookie } = await signedUp("connector-protocol@example.com");
    const { tokens } = await connectAssistant("Cursor", { allowed: FULL, cookie, scope: FULL });
    const bearer = tokens.access_token;

    for (const method of ["GET", "DELETE"] as const) {
      const response = await connectorFetch({ bearer, method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }

    const batch = await connectorFetch({ bearer, body: [rpc("tools/list"), rpc("tools/list")] });
    expect(batch.status).toBe(400);

    const text = await connectorFetch({
      bearer,
      body: "x",
      headers: { "content-type": "text/plain" },
    });

    expect(text.status).toBe(415);
  });

  it("takes a token bound to a key only with a fresh proof of that key, and a bearer token only as one", async () => {
    const { cookie } = await signedUp("connector-dpop@example.com");
    const key = dpopKey();

    const { tokens } = await connectAssistant("Claude", {
      allowed: FULL,
      cookie,
      dpop: key,
      scope: FULL,
    });

    expect(tokens.token_type).toBe("DPoP");
    const token = tokens.access_token;

    const sent = async (scheme: "Bearer" | "DPoP", proof?: string) => {
      const headers = { authorization: `${scheme} ${token}` };

      return await connectorFetch({ body: rpc("tools/list"), headers, proof });
    };

    const proof = key.proof("POST", CONNECTOR_RESOURCE, token);
    const served = await sent("DPoP", proof);
    expect(served.status).toBe(200);

    const refusals: [string, "Bearer" | "DPoP", string | undefined, string][] = [
      ["a replayed proof", "DPoP", proof, "invalid_dpop_proof"],
      [
        "another key",
        "DPoP",
        dpopKey().proof("POST", CONNECTOR_RESOURCE, token),
        "invalid_dpop_proof",
      ],
      [
        "another URL",
        "DPoP",
        key.proof("POST", `${CONNECTOR_RESOURCE}/x`, token),
        "invalid_dpop_proof",
      ],
      ["another method", "DPoP", key.proof("GET", CONNECTOR_RESOURCE, token), "invalid_dpop_proof"],
      ["no token presented", "DPoP", key.proof("POST", CONNECTOR_RESOURCE), "invalid_dpop_proof"],
      ["no proof", "DPoP", undefined, "invalid_dpop_proof"],
      ["as a bearer token", "Bearer", undefined, "invalid_token"],
    ];

    for (const [why, scheme, proofJwt, error] of refusals) {
      const response = await sent(scheme, proofJwt);
      expect(response.status, why).toBe(401);
      expect(response.headers.get("www-authenticate"), why).toMatch(
        new RegExp(`^DPoP algs="[^"]*ES256[^"]*", error="${error}"`, "u"),
      );
    }

    const plain = await connectAssistant("Cursor", { allowed: FULL, cookie, scope: FULL });
    expect(plain.tokens.token_type).toBe("Bearer");

    const asDpop = await connectorFetch({
      body: rpc("tools/list"),
      headers: { authorization: `DPoP ${plain.tokens.access_token}` },
      proof: key.proof("POST", CONNECTOR_RESOURCE, plain.tokens.access_token),
    });

    expect(asDpop.status).toBe(401);
  });

  it("refreshes past an access token's expiry, and a disconnect ends both tokens at once", async () => {
    const { cookie, userId } = await signedUp("connector-revoke@example.com");

    const { clientId, tokens } = await connectAssistant("Gemini", {
      allowed: FULL,
      cookie,
      scope: FULL,
    });

    await db
      .update(oauthAccessToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        eq(
          oauthAccessToken.token,
          hashOAuthToken(tokens.access_token.slice(OAUTH_TOKEN_PREFIX.length)),
        ),
      );
    const expired = await connectorFetch({ bearer: tokens.access_token, body: rpc("tools/list") });
    expect(expired.status).toBe(401);

    const refreshed = await refreshTokens(clientId, tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    const fresh = await tokensOf(refreshed);
    expect(await listTools(fresh.access_token)).toContain("search_library");

    const [grant] = await listAssistants(userId);
    expect(await revokeAssistant(userId, grant?.grantId ?? "")).toBe(true);
    const revoked = await connectorFetch({ bearer: fresh.access_token, body: rpc("tools/list") });
    expect(revoked.status).toBe(401);
    const dead = await refreshTokens(clientId, fresh.refresh_token);
    expect(dead.status).not.toBe(200);
    expect(await revokeAssistant(userId, grant?.grantId ?? "")).toBe(false);
  });

  it("disconnects every assistant when the password is reset", async () => {
    const email = "connector-reset@example.com";
    const { cookie, userId } = await signedUp(email);
    const { tokens } = await connectAssistant("Claude", { allowed: FULL, cookie, scope: FULL });

    const reset = await authPost(
      "/reset-password",
      { origin: ORIGIN },
      { newPassword: "a-new-password-5678", token: await issueToken(email) },
    );

    expect(reset.status).toBe(200);
    const after = await connectorFetch({ bearer: tokens.access_token, body: rpc("tools/list") });
    expect(after.status).toBe(401);
    expect(await listAssistants(userId)).toStrictEqual([]);
  });
});
