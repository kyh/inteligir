// The LOCAL face of cloud sync: what the workspace UI and the CLI need to know
// about this install's relationship with an account, and the verbs that change
// it.
//
// It is deliberately not a mirror of this package's own `./cloud` entry. That
// half is the wire between this machine and the Worker; this one is the wire
// between the renderer and the Node process that owns the credential — and the
// credential itself must never cross it. Nothing here carries the bearer, and
// `deviceId` is the only identity a client is shown: it is what the account's
// dashboard lists, so it is what a user needs to recognise this machine among
// their devices and revoke it.
//
// PAIRING IS THE SWITCH. There is no separate "sync enabled" flag, because two
// values that must agree are two values that can disagree: an install with a
// credential and the flag off would keep a live credential nothing uses, and
// the flag on without one would be a promise no loop can keep. So the state is
// a three-way union over the credential this data dir holds.

import { DEVICE_NAME_MAX_LENGTH } from "@repo/api/cloud/pairing/pairing-schema";
import { z } from "zod";

/**
 * The cloud's own ceiling, re-exported rather than restated.
 *
 * The name this route accepts is the name the eventual redeem sends, so
 * anything accepted here and refused there is a value the user is told is fine
 * and then sees refused — with a shape error arriving long after the click that
 * caused it. One spelling, imported: the local surface cannot drift wider than
 * the thing it feeds.
 */
export const CLOUD_DEVICE_NAME_MAX_LENGTH = DEVICE_NAME_MAX_LENGTH;

export const cloudStatusResponseSchema = z.discriminatedUnion("state", [
  /** No credential in the data dir: no socket, no timer, no request. */
  z
    .object({
      state: z.literal("off"),
      /** Which deployment a pair would dial, so the UI can name the account
       *  the browser is about to be sent to. */
      cloudUrl: z.url(),
    })
    .strict(),
  z
    .object({
      state: z.literal("paired"),
      cloudUrl: z.url(),
      /** This machine's row in the account's device list. */
      deviceId: z.string().min(1),
      /** Whether the invalidation socket is currently up. A pull still runs on
       *  the timer without it, so this is latency, not correctness. */
      connected: z.boolean(),
      /** Events queued for the log and not yet stored by it. */
      pending: z.number().int().nonnegative(),
      /** The account log's global `seq` this device has applied through. */
      cursor: z.number().int().nonnegative(),
      lastSyncedAt: z.number().int().nullable(),
      /** The last attempt's refusal, in the cloud's own words; null once one
       *  succeeds. Being behind is not an error state — a laptop that is
       *  offline is paired and behind, which is what local-first means. */
      lastError: z.string().nullable(),
    })
    .strict(),
  /**
   * The credential is present and the cloud refuses it — revoked from the
   * dashboard, or the account deleted. Distinct from `off` because the two
   * need different sentences and different buttons: this one is an event that
   * happened TO the user, and the fix is to unpair and pair again rather than
   * to wonder why nothing syncs. No timer and no socket run here either: a
   * credential the server has rejected will be rejected again.
   */
  z
    .object({
      state: z.literal("unauthorized"),
      cloudUrl: z.url(),
      deviceId: z.string().min(1),
      detail: z.string().min(1),
    })
    .strict(),
]);
export type CloudStatusResponse = z.infer<typeof cloudStatusResponseSchema>;

export const cloudPairBeginRequestSchema = z
  .object({
    /** How this machine appears in the account's device list. Absent means the
     *  server's own hostname — the machine knows its name, and asking a user to
     *  retype it is a field that exists to be left at its default. */
    deviceName: z.string().trim().min(1).max(CLOUD_DEVICE_NAME_MAX_LENGTH).optional(),
    /**
     * Whether the SERVER launches the system browser at the URL it answers
     * with.
     *
     * A request field rather than a second route, because "begin a pairing" is
     * one act and who opens the window is a property of the caller, not a
     * different verb. It is required, not defaulted: the caller that must say
     * `false` is an agent shell, where a browser window nobody asked for is the
     * failure, and a default would be exactly the value that path forgets to
     * override.
     */
    openBrowser: z.boolean(),
  })
  .strict();
export type CloudPairBeginRequest = z.infer<typeof cloudPairBeginRequestSchema>;

export const cloudPairBeginResponseSchema = z
  .object({
    /** The approve page, on the configured deployment. Answered whether or not
     *  the browser opened, so a caller always has something to show. */
    url: z.url(),
    /** Whether the system browser was launched. False is not a failure — it is
     *  also what `openBrowser: false` asks for — so the caller decides what to
     *  say about it. */
    opened: z.boolean(),
    /** The name the approve page will show, resolved. */
    deviceName: z.string().min(1),
    /** How long the pending state lives. After that the callback is inert and
     *  the user begins again. */
    expiresInMs: z.number().int().positive(),
  })
  .strict();
export type CloudPairBeginResponse = z.infer<typeof cloudPairBeginResponseSchema>;
