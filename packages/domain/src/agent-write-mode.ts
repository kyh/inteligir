// Where a delegated turn's file writes LAND: straight into the vault, or into
// a proposal the user reviews first. It is a per-thread fact rather than a
// per-turn one, because a thread is one conversation and its later turns
// refine the same work — a turn that proposed and a follow-up that wrote
// directly would leave half the answer behind a review gate and half already
// on disk.
//
// `ask` delegations never write at all, so this says nothing about them.

import { z } from "zod";

export const AGENT_WRITE_MODE_VALUES = ["direct", "propose"] as const;
export const agentWriteModeSchema = z.enum(AGENT_WRITE_MODE_VALUES);
export type AgentWriteMode = z.infer<typeof agentWriteModeSchema>;

/** What a thread created without an explicit mode gets — v1's behaviour, so
 *  every existing caller (the CLI, a plain chat thread) keeps writing directly
 *  until someone asks for review. */
export const DEFAULT_AGENT_WRITE_MODE: AgentWriteMode = "direct";
