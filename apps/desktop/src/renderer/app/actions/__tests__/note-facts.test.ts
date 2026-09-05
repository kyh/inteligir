import {
  VAULT_HISTORY_MAX_LIMIT,
  type VaultHistoryRequest,
  type VaultRevision,
} from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";

import { firstRevisionAuthoredAt, readingTimeLabel } from "../note-facts";

function revision(index: number): VaultRevision {
  return {
    sha: "a".repeat(40),
    authoredAt: `2026-01-${String(1 + (index % 28)).padStart(2, "0")}T00:00:00+00:00`,
    authorName: "kyh",
    authorEmail: "kyh@example.com",
    subject: `edit ${String(index)}`,
    path: "notes/a.md",
  };
}

// newest first, like the log
function historyOver(count: number) {
  const requests: VaultHistoryRequest[] = [];
  const revisions = Array.from({ length: count }, (_, i) => revision(i));
  return {
    requests,
    api: {
      vault: {
        history: (input: VaultHistoryRequest) => {
          requests.push(input);
          const skip = input.skip ?? 0;
          const limit = input.limit ?? VAULT_HISTORY_MAX_LIMIT;
          return Promise.resolve({ revisions: revisions.slice(skip, skip + limit) });
        },
      },
    },
  };
}

describe("the created date", () => {
  it("is the oldest revision, which sits on the last page", async () => {
    const { api, requests } = historyOver(VAULT_HISTORY_MAX_LIMIT + 3);
    const oldest = revision(VAULT_HISTORY_MAX_LIMIT + 2).authoredAt;
    expect(await firstRevisionAuthoredAt(api, "notes/a.md")).toBe(oldest);
    expect(requests.map((request) => request.skip ?? 0)).toEqual([0, VAULT_HISTORY_MAX_LIMIT]);
  });

  it("stops at the first short page", async () => {
    const { api, requests } = historyOver(2);
    expect(await firstRevisionAuthoredAt(api, "notes/a.md")).toBe(revision(1).authoredAt);
    expect(requests).toHaveLength(1);
  });

  it("is null for a note the log has not seen", async () => {
    expect(await firstRevisionAuthoredAt(historyOver(0).api, "notes/new.md")).toBeNull();
  });
});

describe("reading time", () => {
  it("is spelled in whole minutes, and withheld for an empty note", () => {
    expect(readingTimeLabel(0)).toBe("—");
    expect(readingTimeLabel(150)).toBe("1 min");
    expect(readingTimeLabel(650)).toBe("4 min");
  });
});
