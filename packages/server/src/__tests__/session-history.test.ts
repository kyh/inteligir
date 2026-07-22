// The read-only past-chat browser's pure parsing (list titles, ordering,
// active-thread exclusion) and readChatSessionById's reject-by-value contract.

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildNoteContext } from "@repo/bridge/note-context";

import {
  readChatSessionById,
  sessionTitle,
  summarizeSessions,
  type SessionListing,
} from "../app/session-history";

// ---------------------------------------------------------------------------
// sessionTitle
// ---------------------------------------------------------------------------

describe("sessionTitle", () => {
  it("strips the auto-attached note-context prefix", () => {
    const stored = buildNoteContext("Summarize this note", "notes/todo.md");
    expect(stored.startsWith("[Context:")).toBe(true);
    expect(sessionTitle(stored)).toBe("Summarize this note");
  });

  it("collapses whitespace into one line", () => {
    expect(sessionTitle("plan\nthe   week\n\n- item")).toBe("plan the week - item");
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "x".repeat(200);
    const title = sessionTitle(long);
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to (empty) for blank or message-less sessions", () => {
    expect(sessionTitle("")).toBe("(empty)");
    expect(sessionTitle("   \n ")).toBe("(empty)");
    // pi's SessionInfo sentinel when a session has no user text.
    expect(sessionTitle("(no messages)")).toBe("(empty)");
  });
});

// ---------------------------------------------------------------------------
// summarizeSessions
// ---------------------------------------------------------------------------

function listing(overrides: Partial<SessionListing> & { id: string }): SessionListing {
  return {
    modified: new Date("2026-07-01T00:00:00Z"),
    messageCount: 2,
    firstMessage: `message of ${overrides.id}`,
    ...overrides,
  };
}

describe("summarizeSessions", () => {
  it("orders newest-first and maps titles + timestamps", () => {
    const older = listing({ id: "old1", modified: new Date("2026-07-01T00:00:00Z") });
    const newer = listing({ id: "new1", modified: new Date("2026-07-10T00:00:00Z") });
    const rows = summarizeSessions([older, newer], null);
    expect(rows.map((r) => r.id)).toEqual(["new1", "old1"]);
    expect(rows[0]?.title).toBe("message of new1");
    expect(rows[0]?.updatedAt).toBe(newer.modified.getTime());
    expect(rows[0]?.messageCount).toBe(2);
  });

  it("excludes the active thread and message-less sessions", () => {
    const rows = summarizeSessions(
      [
        listing({ id: "active1" }),
        listing({ id: "past1" }),
        listing({ id: "blank1", messageCount: 0 }),
      ],
      "active1",
    );
    expect(rows.map((r) => r.id)).toEqual(["past1"]);
  });

  it("strips the note-context prefix from titles", () => {
    const rows = summarizeSessions(
      [listing({ id: "s1", firstMessage: buildNoteContext("Hello agent", undefined) })],
      null,
    );
    expect(rows[0]?.title).toBe("Hello agent");
  });
});

// ---------------------------------------------------------------------------
// readChatSessionById
// ---------------------------------------------------------------------------

const dirs: string[] = [];
function tempSessionDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-session-history-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function writeSession(dir: string, id: string, lines: unknown[]): string {
  const path = join(dir, `2026-07-01T00-00-00-000Z_${id}.jsonl`);
  writeFileSync(path, lines.map(sessionLine).join(""));
  return path;
}

function header(id: string): unknown {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-07-01T00:00:00.000Z",
    cwd: "/tmp/workspace",
  };
}

function userMessage(entryId: string, parentId: string | null, text: string): unknown {
  return {
    type: "message",
    id: entryId,
    parentId,
    timestamp: "2026-07-01T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1751328001000 },
  };
}

describe("readChatSessionById", () => {
  it("rejects malformed ids without touching the directory", () => {
    for (const bad of ["", "../escape", "a/b", "has space", ".hidden", "trailing-"]) {
      const result = readChatSessionById(bad, "/nonexistent-session-dir");
      expect(result).toEqual({ ok: false, error: "Malformed session id" });
    }
  });

  it("rejects an unknown id as a value", () => {
    const result = readChatSessionById("nope1234", tempSessionDir());
    expect(result.ok).toBe(false);
  });

  it("reads a session's transcript by id", () => {
    const dir = tempSessionDir();
    writeSession(dir, "abc12345", [
      header("abc12345"),
      userMessage("m1", null, "Hello there"),
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-07-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi! How can I help?" }],
          timestamp: 1751328002000,
        },
      },
    ]);
    const result = readChatSessionById("abc12345", dir);
    expect(result).toEqual({
      ok: true,
      entries: [
        { role: "user", text: "Hello there" },
        { role: "assistant", text: "Hi! How can I help?" },
      ],
    });
  });

  it("refuses a file whose header id does not match its name", () => {
    const dir = tempSessionDir();
    writeSession(dir, "claimed1", [header("actual99"), userMessage("m1", null, "hi")]);
    const result = readChatSessionById("claimed1", dir);
    expect(result.ok).toBe(false);
  });

  it("refuses an empty session file and leaves it untouched", () => {
    const dir = tempSessionDir();
    const path = writeSession(dir, "empty123", []);
    const result = readChatSessionById("empty123", dir);
    expect(result.ok).toBe(false);
    // Read-only guarantee: SessionManager.open would have written a header.
    expect(statSync(path).size).toBe(0);
  });
});
