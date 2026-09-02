import { z } from "zod";

// the runtime shape, never which harness: a thread carries its own providerId
export const agentModeValues = ["auto", "scripted", "off"] as const;
export const agentModeSchema = z.enum(agentModeValues);
export type AgentMode = z.infer<typeof agentModeSchema>;

// mode is the configuration; runtime is what actually serves turns
export const agentStatusSchema = z
  .object({
    mode: agentModeSchema,
    runtime: z.enum(["acp", "scripted", "unavailable", "off"]),
    detail: z.string().nullable(),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const guideResponseSchema = z.object({ markdown: z.string().min(1) }).strict();
export type GuideResponse = z.infer<typeof guideResponseSchema>;

export const systemStatusResponseSchema = z
  .object({
    version: z.string().min(1),
    dataDir: z.string().min(1),
    vaultDir: z.string().min(1),
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
    agent: agentStatusSchema,
  })
  .strict();
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;
