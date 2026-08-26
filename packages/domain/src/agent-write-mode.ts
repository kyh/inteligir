// The retired review-mode vocabulary (#613): the pipeline that read this
// died whole, and the enum survives ONLY because the `threads.write_mode`
// COLUMN survives — legacy rows hold these spellings, and cross-device sync
// skew makes a column drop unsafe. Nothing branches on it any more.

import { z } from "zod";

export const AGENT_WRITE_MODE_VALUES = ["direct", "propose"] as const;
export const agentWriteModeSchema = z.enum(AGENT_WRITE_MODE_VALUES);
export type AgentWriteMode = z.infer<typeof agentWriteModeSchema>;

/** What a thread created without an explicit mode gets — v1's behaviour, so
 *  every existing caller (the CLI, a plain chat thread) keeps writing directly
 *  until someone asks for review. */
export const DEFAULT_AGENT_WRITE_MODE: AgentWriteMode = "direct";
