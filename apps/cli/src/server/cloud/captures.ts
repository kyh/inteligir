import type { CaptureRow } from "@repo/api/cloud/captures/captures-schema";
import { messageOf } from "../error-message";
import { VaultServiceError, type VaultService } from "../vault/vault-service";

export const CAPTURE_INBOX_PATH = "Inbox.md";

// only needs to outlive a lapsed claim (five minutes by contract); a week is slack.
export const APPLIED_CAPTURE_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type CaptureVault = Pick<VaultService, "read" | "writeIfUnchanged" | "writeGuarded">;

type InboxAppendResult = { applied: true } | { applied: false; reason: string };

// indented continuation lines keep a multi-line capture inside its list item.
function inboxBullet(capture: CaptureRow): string {
  return `- ${capture.text.replaceAll("\n", "\n  ")}\n`;
}

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
