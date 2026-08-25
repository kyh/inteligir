// The system surface: what this instance IS, and the manual it serves.
//
// `GET /health` is deliberately not here. It is a supervisor's spawn probe —
// unauthenticated, trivial, and answered before this process has any reason to
// hold a credential — so it stays a plain HTTP route beside /ws.

import { z } from "zod";

/**
 * What the boot-time driver resolution decided. `mode` is the configuration
 * (INTELIGIR_AGENT / config.json); `runtime` is what actually serves turns —
 * `unavailable` states the reason in `detail` (e.g. no codex binary on PATH)
 * so a 503 on send is diagnosable from status alone.
 */
export const agentStatusSchema = z
  .object({
    mode: z.enum(["auto", "codex", "scripted", "off"]),
    runtime: z.enum(["acp", "scripted", "unavailable", "off"]),
    detail: z.string().nullable(),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

/**
 * The built-in agent guide: a SKILL.md-shaped manual for the `inteligir` CLI,
 * served by the app so an agent (or a human) can always fetch the manual that
 * matches the running build. The CLI's `guide` command prints it.
 */
export const guideResponseSchema = z.object({ markdown: z.string().min(1) }).strict();
export type GuideResponse = z.infer<typeof guideResponseSchema>;

export const systemStatusResponseSchema = z
  .object({
    /** Version of the running server package, read from its package.json. */
    version: z.string().min(1),
    /** Absolute path of the active data directory (where the DB lives) —
     *  which instance answered. */
    dataDir: z.string().min(1),
    /** Absolute path of the vault this instance serves — the other half of
     *  the identity, and what a caller is actually about to write into. */
    vaultDir: z.string().min(1),
    /** The `meta.schema_version` row — proves migrate-on-boot ran. */
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
    agent: agentStatusSchema,
  })
  .strict();
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
