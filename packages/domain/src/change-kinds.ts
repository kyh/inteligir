// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

/**
 * The invalidation vocabulary: what a write can announce about each entity.
 * It sits in the domain rather than in the wire contract because both sides
 * of the wire derive from it — the write layer announces through `DbNotifier`
 * beside this file, and `@repo/server-contract/notifications` builds the ws
 * frames from the same arrays.
 */
export const VAULT_CHANGE_KINDS = ["files-changed", "sync-status-changed"] as const;
export type VaultChangeKind = (typeof VAULT_CHANGE_KINDS)[number];

export const DOC_CHANGE_KINDS = [
  "content-changed",
  /** A suggested edit against this doc was captured or resolved. Separate
   *  from `content-changed` because the doc's BYTES did not move: a reader
   *  that treats the two alike re-reads a file to learn about a row. */
  "proposals-changed",
] as const;
export type DocChangeKind = (typeof DOC_CHANGE_KINDS)[number];

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "events-appended",
  "status-changed",
  "archived-changed",
  "queue-changed",
  "interactions-changed",
  /** The doc a delegation is bound to moved (a rename followed it). */
  "origin-changed",
  /** This thread's suggested edits changed — captured by a turn, or resolved
   *  by a review. */
  "proposals-changed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];

export const vaultChangeKindSchema = z.enum(VAULT_CHANGE_KINDS);
export const docChangeKindSchema = z.enum(DOC_CHANGE_KINDS);
export const threadChangeKindSchema = z.enum(THREAD_CHANGE_KINDS);
