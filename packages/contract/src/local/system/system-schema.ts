import { z } from "zod";

// the runtime shape, never which harness: a thread carries its own providerId
export const agentModeValues = ["acp", "scripted", "off"] as const;
export const agentModeSchema = z.enum(agentModeValues);
export type AgentMode = z.infer<typeof agentModeSchema>;

// mode is the configuration. Only the ACP runtime can be configured and not serve turns: the harness
// a new thread starts on is missing from this copy of the app, which detail says in the person's
// words.
export const agentStatusSchema = z.discriminatedUnion("mode", [
  z.discriminatedUnion("runtime", [
    z.strictObject({ mode: z.literal("acp"), runtime: z.literal("ready") }),
    z.strictObject({
      detail: z.string().min(1),
      mode: z.literal("acp"),
      runtime: z.literal("unavailable"),
    }),
  ]),
  z.strictObject({ mode: z.literal("scripted") }),
  z.strictObject({ mode: z.literal("off") }),
]);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

// the status in configuration words, for the server's boot line and `inteligir status`
export const agentStatusLine = (agent: AgentStatus): string =>
  agent.mode === "acp" && agent.runtime === "unavailable"
    ? `acp, unavailable — ${agent.detail}`
    : agent.mode;

export const guideResponseSchema = z.strictObject({ markdown: z.string().min(1) });
export type GuideResponse = z.infer<typeof guideResponseSchema>;

export const systemStatusResponseSchema = z.strictObject({
  agent: agentStatusSchema,
  dataDir: z.string().min(1),
  schemaVersion: z.number().int().min(1),
  uptimeMs: z.number().min(0),
  vaultDir: z.string().min(1),
  version: z.string().min(1),
});
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

export const browserHandoffResponseSchema = z.strictObject({ nonce: z.string().min(1) });
export type BrowserHandoffResponse = z.infer<typeof browserHandoffResponseSchema>;
