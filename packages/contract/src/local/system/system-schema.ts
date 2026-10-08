import { z } from "zod";

// auto: whatever agent runtime this build has, which is none yet; scripted: the in-process fake the
// scenario suite drives; off: every send refused
export const agentModeValues = ["auto", "scripted", "off"] as const;
export const agentModeSchema = z.enum(agentModeValues);
export type AgentMode = z.infer<typeof agentModeSchema>;

// mode is the configuration; runtime is what actually serves turns
export const agentStatusSchema = z
  .object({
    detail: z.string().nullable(),
    mode: agentModeSchema,
    runtime: z.enum(["scripted", "unavailable", "off"]),
  })
  .strict();
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const systemStatusResponseSchema = z
  .object({
    agent: agentStatusSchema,
    dataDir: z.string().min(1),
    schemaVersion: z.number().int().min(1),
    uptimeMs: z.number().min(0),
    version: z.string().min(1),
  })
  .strict();
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

export const browserHandoffResponseSchema = z.object({ nonce: z.string().min(1) }).strict();
export type BrowserHandoffResponse = z.infer<typeof browserHandoffResponseSchema>;
