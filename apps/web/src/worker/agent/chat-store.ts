// ---------------------------------------------------------------------------
// The durable chat transcript, in the user's own Durable Object.
//
// THE DECISION THIS MODULE IS: the Durable Object owns the transcript, and pi's
// session files are disposable working state.
//
// The desktop read `sessions/*.jsonl` off local disk with `readdirSync` and
// `statSync` — the files pi wrote were the record. That cannot survive the
// move: the container filesystem is deleted on every sleep, so a transcript
// living there would vanish between two messages in the same conversation.
// Something has to be authoritative, and there are only two candidates.
//
// REHYDRATING pi's session directory on wake was the alternative. It was
// rejected: the jsonl is pi's private format, so writing it from the Worker
// would mean this repo hand-authoring a third party's on-disk representation
// and keeping step with it across upgrades — precisely the coupling the pi
// quarantine exists to prevent, relocated somewhere no test could see it.
//
// So a wake starts a FRESH pi session and seeds it with prior turns as context
// (see `seed`). What that costs is real and worth stating: pi's own view of the
// conversation restarts, so anything it held that is not in the transcript —
// tool results, its internal message ids — does not come back. What it buys is
// one authority. The transcript is what every client already reads
// (`getAgentHistory`), what the session browser lists, and what survives an
// image rebuild; two authorities is how they drift.
//
// Tool rows are RECORDED but never seeded. They are turn decoration — the chat
// fold sweeps them at `agent_end` and history rehydration skips them
// (@repo/bridge/chat-log) — and replaying a tool result into a fresh session as
// prose would read to the model as something it did, in a session where it did
// not.
// ---------------------------------------------------------------------------

import type { ChatSessionSummary, ReadChatSessionResult } from "@repo/bridge/chat-sessions";
import type { ChatHistoryEntry } from "@repo/bridge/chat-log";
import { stripNoteContext } from "@repo/bridge/note-context";

import type { SandboxSeedTurn } from "./sandbox-port";

/** Threads kept before the oldest is dropped. A chat thread is a handful of
 * kilobytes, and the session browser is a browsing affordance rather than an
 * archive — but a Durable Object's SQLite is not free, so the tail goes. */
const MAX_SESSIONS = 50;

/** Turns replayed into a fresh pi session. Every seeded turn is prompt on every
 * later turn of that session, so this is a recurring cost, not a one-off. */
const SEED_TURNS = 40;

/** Longest seeded turn, in characters. A single note pasted into chat can be
 * larger than the whole rest of the thread; seeding it whole would spend the
 * context window on something the agent can simply read from `./vault`. */
const SEED_TEXT_LIMIT = 4000;

/** Longest title kept for the session listing. */
const TITLE_LIMIT = 80;

type TurnRow = {
  readonly seq: number;
  readonly role: string;
  readonly text: string;
  readonly tool_name: string | null;
  readonly tool_call_id: string | null;
  readonly is_error: number;
};

export type ChatRole = "user" | "assistant" | "tool";

export class ChatStore {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    // Synchronous, so the tables exist before anything in the object's
    // construction can reach them. `agent_` prefixed because this object's
    // SQLite is shared with the vault manifest and the knowledge index.
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_sessions (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         active INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS agent_turns (
         seq INTEGER PRIMARY KEY,
         session_id TEXT NOT NULL,
         role TEXT NOT NULL,
         text TEXT NOT NULL,
         tool_name TEXT,
         tool_call_id TEXT,
         is_error INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS agent_turns_session ON agent_turns (session_id, seq)",
    );
  }

  // ---- sessions -------------------------------------------------------------

  /** The live thread's id, creating it on first use. Chat is a single
   * persistent thread; this is the one a client reaches without naming it. */
  activeSessionId(): string {
    const row = this.sql
      .exec<{ id: string }>("SELECT id FROM agent_sessions WHERE active = 1 LIMIT 1")
      .toArray()[0];
    if (row !== undefined) return row.id;
    return this.openSession();
  }

  /** Roll a fresh thread and make it the live one. */
  newSession(): string {
    this.sql.exec("UPDATE agent_sessions SET active = 0 WHERE active = 1");
    const id = this.openSession();
    this.prune();
    return id;
  }

  /** Past threads, newest first, with the live one excluded — it is already the
   * chat on screen. Empty threads are excluded too: rolling a session and never
   * using it should not leave a row in the browser. */
  sessions(): ChatSessionSummary[] {
    return this.sql
      .exec<{ id: string; title: string; updated_at: number; n: number }>(
        `SELECT s.id, s.title, s.updated_at, COUNT(t.seq) AS n
         FROM agent_sessions s
         LEFT JOIN agent_turns t ON t.session_id = s.id
         WHERE s.active = 0
         GROUP BY s.id
         HAVING n > 0
         ORDER BY s.updated_at DESC, s.id`,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updated_at,
        messageCount: row.n,
      }));
  }

  /** One past thread's transcript. An unknown id is an `{ ok: false }` VALUE
   * (the registry's contract), never a throw. */
  read(id: string): ReadChatSessionResult {
    const known = this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM agent_sessions WHERE id = ?", id)
      .toArray()[0];
    if (known === undefined || known.n === 0) return { ok: false, error: "No such chat thread." };
    return { ok: true, entries: this.entries(id) };
  }

  /** The live thread's transcript — what `getAgentHistory` answers. */
  history(): ChatHistoryEntry[] {
    return this.entries(this.activeSessionId());
  }

  // ---- writes ---------------------------------------------------------------

  /** Record what the user said. Returns the transcript sequence it landed at,
   * which is what a dispatch reports as `seededThrough`. */
  appendUser(text: string): number {
    const sessionId = this.activeSessionId();
    const seq = this.append(sessionId, "user", text, null, null, false);
    this.titleFrom(sessionId, text);
    return seq;
  }

  appendAssistant(text: string, isError: boolean): number {
    return this.append(this.activeSessionId(), "assistant", text, null, null, isError);
  }

  /** Open a tool row. Split from `settleTool` because only the START event
   * carries the tool's NAME and only the END event carries its result — and a
   * host that held the pairing in memory would lose it to an eviction between
   * two reports of the same turn. */
  openTool(toolName: string, toolCallId: string): number {
    return this.append(this.activeSessionId(), "tool", "", toolName, toolCallId, false);
  }

  /** Fill in a tool row's result. A call id with no open row is ignored: the
   * end of a tool this transcript never saw begin is not a row to invent. */
  settleTool(toolCallId: string, text: string, isError: boolean): void {
    this.sql.exec(
      "UPDATE agent_turns SET text = ?, is_error = ? WHERE tool_call_id = ? AND role = 'tool'",
      text,
      isError ? 1 : 0,
      toolCallId,
    );
  }

  /** The transcript's head — the sequence a dispatch would seed through. */
  head(): number {
    const row = this.sql
      .exec<{ head: number | null }>("SELECT MAX(seq) AS head FROM agent_turns")
      .toArray()[0];
    return row?.head ?? 0;
  }

  /**
   * The live thread's recent conversation, oldest first, for seeding a fresh
   * pi session.
   *
   * User text is stripped of the auto-attached note-context prefix: the fresh
   * session is told about the open note by its own instructions, and replaying
   * a stale `[Context: …]` line would tell it about a note the user has since
   * navigated away from.
   */
  seed(): SandboxSeedTurn[] {
    const sessionId = this.activeSessionId();
    const rows = this.sql
      .exec<TurnRow>(
        `SELECT seq, role, text, tool_name, tool_call_id, is_error
         FROM agent_turns WHERE session_id = ? AND role IN ('user','assistant')
         ORDER BY seq DESC LIMIT ?`,
        sessionId,
        SEED_TURNS,
      )
      .toArray();
    return rows
      .toReversed()
      .filter(
        (row): row is TurnRow & { role: "user" | "assistant" } =>
          row.role === "user" || row.role === "assistant",
      )
      .map((row) => ({
        seq: row.seq,
        role: row.role,
        text: clamp(row.role === "user" ? stripNoteContext(row.text) : row.text, SEED_TEXT_LIMIT),
      }));
  }

  // ---- internals ------------------------------------------------------------

  private openSession(): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO agent_sessions (id, title, created_at, updated_at, active) VALUES (?, ?, ?, ?, 1)",
      id,
      "New chat",
      now,
      now,
    );
    return id;
  }

  private append(
    sessionId: string,
    role: ChatRole,
    text: string,
    toolName: string | null,
    toolCallId: string | null,
    isError: boolean,
  ): number {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO agent_turns (session_id, role, text, tool_name, tool_call_id, is_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      role,
      text,
      toolName,
      toolCallId,
      isError ? 1 : 0,
      now,
    );
    this.sql.exec("UPDATE agent_sessions SET updated_at = ? WHERE id = ?", now, sessionId);
    return this.head();
  }

  private entries(sessionId: string): ChatHistoryEntry[] {
    return this.sql
      .exec<TurnRow>(
        `SELECT seq, role, text, tool_name, tool_call_id, is_error
         FROM agent_turns WHERE session_id = ? ORDER BY seq`,
        sessionId,
      )
      .toArray()
      .flatMap((row): ChatHistoryEntry[] => {
        const role = toRole(row.role);
        if (role === null) return [];
        // Optional fields stay ABSENT rather than `undefined`: the wire shape
        // is a projection of the row, and a key with no value is not the same
        // thing as a key that is not there.
        return [
          {
            role,
            text: row.text,
            ...(row.tool_name === null ? {} : { toolName: row.tool_name }),
            ...(row.tool_call_id === null ? {} : { toolCallId: row.tool_call_id }),
            ...(row.is_error === 0 ? {} : { isError: true }),
          },
        ];
      });
  }

  /** Name a thread after its first user message, once. */
  private titleFrom(sessionId: string, text: string): void {
    const current = this.sql
      .exec<{ title: string }>("SELECT title FROM agent_sessions WHERE id = ?", sessionId)
      .toArray()[0];
    if (current === undefined || current.title !== "New chat") return;
    const title = clamp(stripNoteContext(text).trim().split("\n")[0] ?? "", TITLE_LIMIT);
    if (title === "") return;
    this.sql.exec("UPDATE agent_sessions SET title = ? WHERE id = ?", title, sessionId);
  }

  /** Drop the oldest threads past the retention cap, turns and all. */
  private prune(): void {
    const doomed = this.sql
      .exec<{ id: string }>(
        `SELECT id FROM agent_sessions WHERE active = 0
         ORDER BY updated_at DESC, id LIMIT -1 OFFSET ?`,
        MAX_SESSIONS,
      )
      .toArray();
    for (const row of doomed) {
      this.sql.exec("DELETE FROM agent_turns WHERE session_id = ?", row.id);
      this.sql.exec("DELETE FROM agent_sessions WHERE id = ?", row.id);
    }
  }
}

function toRole(value: string): ChatRole | null {
  return value === "user" || value === "assistant" || value === "tool" ? value : null;
}

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
