// THE CAPTURE APPLY WRITES ONE NOTE, and that is the whole of this module.
// The claim, the ledger and the ack stay with the sync loop — they are an
// ORDER across two stores, which is a property no single write can hold. What
// lives here is the other half: where a capture lands, what it looks like on
// the page, and the guarded write that puts it there.
//
// The pairing is deliberate: `outbox.ts` holds the push half's serialization
// rule, this holds the pull half's rendering rule, and the runtime is left
// owning only the ordering that is genuinely its own.

import type { CaptureRow } from "@repo/api/cloud/captures/captures-schema";
import { messageOf } from "../knowledge/message-of";
import { VaultServiceError, type VaultService } from "../vault/vault-service";

/** Where a claimed capture lands. One note rather than a dated one: a daily
 *  note is a vault convention this product has not chosen yet, and inventing
 *  one here would put the choice in the sync client. */
export const CAPTURE_INBOX_PATH = "Inbox.md";

/** How long an applied capture id is remembered. The only window it has to
 *  cover is a lapsed claim being handed to this device again, which the
 *  contract bounds at five minutes — a week is slack, not a requirement. */
export const APPLIED_CAPTURE_RETENTION_MS = 7 * 24 * 60 * 60_000;

/**
 * The slice of the vault a claimed capture needs. Narrow on purpose: this
 * runtime writes exactly ONE note, and handing it the whole service is how a
 * sync client quietly becomes a second writer of the vault.
 */
export type CaptureVault = Pick<VaultService, "read" | "writeIfUnchanged" | "writeGuarded">;

/** Why nothing landed, reported rather than logged: the caller owns what a
 *  pass says about itself, and it is the one that decides the claim lapses. */
type InboxAppendResult = { applied: true } | { applied: false; reason: string };

/** One capture, one bullet. Continuation lines are indented so a multi-line
 *  capture stays inside its own list item instead of ending the list. */
function inboxBullet(capture: CaptureRow): string {
  return `- ${capture.text.replaceAll("\n", "\n  ")}\n`;
}

/** Append these captures to the inbox note, creating it when it is absent.
 *  Both writes are guarded against the bytes this call read, so a save that
 *  landed in between keeps them and the captures are reported unapplied. */
export async function appendToInbox(
  vault: CaptureVault,
  captures: readonly CaptureRow[],
): Promise<InboxAppendResult> {
  const addition = captures.map(inboxBullet).join("");
  try {
    const current = await vault.read(CAPTURE_INBOX_PATH);
    const separator = current.content === "" || current.content.endsWith("\n") ? "" : "\n";
    const result = await vault.writeIfUnchanged(
      CAPTURE_INBOX_PATH,
      current.content,
      `${current.content}${separator}${addition}`,
    );
    if (!result.applied) {
      return {
        applied: false,
        reason: `${CAPTURE_INBOX_PATH} changed under the capture write; retrying next pass`,
      };
    }
    return { applied: true };
  } catch (error) {
    if (!(error instanceof VaultServiceError) || error.code !== "not_found") {
      return {
        applied: false,
        reason: `could not write ${CAPTURE_INBOX_PATH}: ${messageOf(error)}`,
      };
    }
  }
  const created = await vault.writeGuarded(CAPTURE_INBOX_PATH, `# Inbox\n\n${addition}`, {
    ifAbsent: true,
  });
  if (!created.applied) {
    return {
      applied: false,
      reason: `${CAPTURE_INBOX_PATH} appeared under the capture write; retrying next pass`,
    };
  }
  return { applied: true };
}
