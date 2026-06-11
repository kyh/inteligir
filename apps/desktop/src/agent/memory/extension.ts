/**
 * Memory extension — long-term memory backed by a self-hosted supermemory
 * server (https://supermemory.ai/docs/self-hosting/overview).
 *
 * Two halves:
 *  - the `memory` tool: add / search / profile / list / forget against the
 *    local server (default http://localhost:6767, override with
 *    SUPERMEMORY_BASE_URL — see agent/memory/client.ts);
 *  - recall priming: each agent run is primed with the distilled user
 *    profile (static facts + recent context) as a hidden message, the same
 *    way the tasks extension primes the active task list.
 *
 * The server is opt-in and user-managed for now: `npx supermemory local`
 * installs and runs it (one LLM provider key in ~/.supermemory/env is
 * required for memory extraction). Nothing here installs binaries — when
 * the server isn't reachable the tool answers with setup guidance and the
 * priming hook stays silent, so the extension is inert until the user
 * starts the server. Owning the server lifecycle (spawn/health/shutdown)
 * is the obvious next step if the experiment sticks.
 */

import { Type, type Static } from "@sinclair/typebox";

import type { PiExtensionBundle } from "@/agent/extension";
import { textResult } from "@/agent/extension-helpers";
import { toErrorMessage } from "@/shared/ipc";
import {
  MemoryClient,
  MemoryUnavailableError,
  resolveMemoryConfig,
  type MemoryProfile,
} from "@/agent/memory/client";

const memorySchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("add"),
      Type.Literal("search"),
      Type.Literal("profile"),
      Type.Literal("list"),
      Type.Literal("forget"),
    ],
    { description: "Action to perform" },
  ),
  content: Type.Optional(
    Type.String({
      description:
        "Memory text to store (required for add). One self-contained fact per call, " +
        "e.g. 'User prefers metric units' — not a transcript dump.",
    }),
  ),
  query: Type.Optional(
    Type.String({ description: "Natural-language search query (required for search)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results for search/list (default 10/20)" })),
  memoryId: Type.Optional(
    Type.String({ description: "Memory id to forget (forget needs this or 'content')" }),
  ),
  reason: Type.Optional(Type.String({ description: "Optional reason when forgetting" })),
});

type MemoryParams = Static<typeof memorySchema>;

function unavailableGuidance(err: MemoryUnavailableError): string {
  return (
    `${err.message}. Long-term memory is unavailable until the local supermemory ` +
    "server is running. The user can set it up with `npx supermemory local` " +
    "(adds an LLM provider key to ~/.supermemory/env on first run) and keep it " +
    "running in the background. Continue without memory for now."
  );
}

function formatProfile(profile: MemoryProfile): string {
  const lines: string[] = [];
  if (profile.static.length > 0) {
    lines.push("Stable facts:", ...profile.static.map((f) => `- ${f}`));
  }
  if (profile.dynamic.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Recent context:", ...profile.dynamic.map((f) => `- ${f}`));
  }
  return lines.join("\n");
}

/** Method surface the tool needs — lets tests inject a stub client. */
export type MemoryToolClient = Pick<MemoryClient, "add" | "search" | "profile" | "list" | "forget">;

/** Exported for unit testing — see __tests__/memory-extension.test.ts. */
export function buildMemoryTool(client: MemoryToolClient) {
  return {
    name: "memory",
    label: "memory",
    description:
      "Long-term memory across conversations (local supermemory server). " +
      "Use 'add' to remember durable facts about the user — preferences, decisions, " +
      "projects, people — as soon as they come up; one concise fact per call. " +
      "Use 'search' before answering questions that depend on prior context, " +
      "'profile' for a distilled summary of the user, 'list' for recently stored " +
      "entries, and 'forget' (by memoryId or content description) when the user " +
      "asks you to forget something.",
    parameters: memorySchema,
    execute: async (_toolCallId: string, params: MemoryParams) => {
      try {
        switch (params.action) {
          case "add": {
            if (!params.content)
              return textResult("Error: 'content' is required for action 'add'.");
            const added = await client.add(params.content, { source: "agent" });
            return textResult(`Stored memory ${added.id} (status: ${added.status}).`);
          }
          case "search": {
            if (!params.query) return textResult("Error: 'query' is required for action 'search'.");
            const found = await client.search(params.query, params.limit ?? 10);
            if (found.results.length === 0) {
              return textResult(`No memories matched "${params.query}".`);
            }
            const lines = found.results.map((hit) => {
              const text = hit.memory ?? hit.chunk ?? "(no content)";
              return `- [${hit.similarity.toFixed(2)}] ${text} (${hit.id})`;
            });
            return textResult(`${found.total} result(s):\n${lines.join("\n")}`);
          }
          case "profile": {
            const profile = await client.profile();
            const text = formatProfile(profile);
            return textResult(text || "No profile yet — nothing has been remembered.");
          }
          case "list": {
            const listed = await client.list(params.limit ?? 20);
            if (listed.length === 0) return textResult("No memories stored yet.");
            const lines = listed.map((doc) => {
              const label = doc.title ?? doc.summary ?? "(untitled)";
              return `- ${label} (${doc.id}${doc.status ? `, ${doc.status}` : ""})`;
            });
            return textResult(lines.join("\n"));
          }
          case "forget": {
            if (!params.memoryId && !params.content) {
              return textResult(
                "Error: 'forget' needs 'memoryId' or a 'content' description of what to forget.",
              );
            }
            const forgotten = await client.forget({
              ...(params.memoryId !== undefined ? { id: params.memoryId } : {}),
              ...(params.content !== undefined ? { content: params.content } : {}),
              ...(params.reason !== undefined ? { reason: params.reason } : {}),
            });
            return textResult(
              forgotten.forgotten
                ? `Forgot memory ${forgotten.id}.`
                : `Nothing was forgotten (server declined for ${forgotten.id}).`,
            );
          }
        }
      } catch (err) {
        if (err instanceof MemoryUnavailableError) return textResult(unavailableGuidance(err));
        return textResult(`memory error: ${toErrorMessage(err)}`);
      }
    },
  };
}

/**
 * Cached profile for recall priming. before_agent_start must not stall the
 * turn on a cold HTTP call, so reads come from the last completed refresh
 * and every read schedules the next one. The cold-start wait budget is
 * spent exactly once, by the first read — a brand-new session still gets
 * primed when the server is warm, while a down, hung, or slow server costs
 * at most one firstLoadWaitMs ever, never one per turn.
 */
export function createProfileCache(client: Pick<MemoryClient, "profile">, firstLoadWaitMs = 1_500) {
  let cached: MemoryProfile | null = null;
  let coldWaitSpent = false;
  let inflight: Promise<void> | null = null;

  const refresh = (): Promise<void> => {
    inflight ??= (async () => {
      try {
        cached = await client.profile();
      } catch {
        // Server down or not set up — drop any previous snapshot so priming
        // goes silent, consistent with the tool reporting unavailability.
        cached = null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  return {
    refresh,
    /** Cached profile; only the first read waits (up to firstLoadWaitMs). */
    async get(): Promise<MemoryProfile | null> {
      const pending = refresh();
      if (!coldWaitSpent) {
        coldWaitSpent = true;
        await Promise.race([pending, new Promise((r) => setTimeout(r, firstLoadWaitMs))]);
      }
      return cached;
    },
  };
}

const memoryExtension: PiExtensionBundle = {
  name: "memory",
  register: () => (pi) => {
    const client = new MemoryClient(resolveMemoryConfig());
    const profileCache = createProfileCache(client);

    pi.registerTool(buildMemoryTool(client));

    pi.on("before_agent_start", async () => {
      const profile = await profileCache.get();
      if (!profile) return;
      const text = formatProfile(profile);
      if (!text) return;

      pi.sendMessage({
        customType: "memory-profile",
        content: `[What you remember about the user]\n${text}`,
        display: false,
      });
    });
  },
};

export default memoryExtension;
