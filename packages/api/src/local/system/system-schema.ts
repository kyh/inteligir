import { z } from "zod";

// the runtime shape, never which harness: a thread carries its own providerId
export const agentModeValues = ["auto", "scripted", "off"] as const;
export const agentModeSchema = z.enum(agentModeValues);
export type AgentMode = z.infer<typeof agentModeSchema>;

// mode is the configuration; runtime is what actually serves turns
export const agentStatusSchema = z
  .object({
    detail: z.string().nullable(),
    mode: agentModeSchema,
    runtime: z.enum(["acp", "scripted", "unavailable", "off"]),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const guideResponseSchema = z.object({ markdown: z.string().min(1) }).strict();
export type GuideResponse = z.infer<typeof guideResponseSchema>;

// root: the default vault's data dir, the one every install has. vault: this vault's own dir
// beneath it, where the credential, the connectors and the agent default start empty.
export const dataDirScopeSchema = z.enum(["root", "vault"]);
export type DataDirScope = z.infer<typeof dataDirScopeSchema>;

export const systemStatusResponseSchema = z
  .object({
    agent: agentStatusSchema,
    dataDir: z.string().min(1),
    dataDirScope: dataDirScopeSchema,
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
    vaultDir: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
