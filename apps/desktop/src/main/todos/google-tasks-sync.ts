// ---------------------------------------------------------------------------
// Google Tasks sync — pulls the user's default task list, reconciles it with
// the local todo store (last-write-wins, see shared/google-tasks.ts), then
// pushes local changes back. Talks to Google through widgetCallTool (the same
// executor code-mode path the Agenda widget uses), so it needs no separate
// OAuth wiring — the connectors flow already minted the connection.
//
// Tool addresses follow the connection-scoped executor format
// <integration>.<owner>.<connection>.<api>.<resource>.<method>, mirroring the
// google_calendar.user.default.calendar.events.list address the seed widgets
// used. The write-method input shape (flat body fields) matches how the
// googleDiscoveryBundle exposes calendar.events.list params.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { widgetCallTool } from "@/main/widget-actions";
import { getTodoManager } from "@/main/todos/todo-manager";
import {
  parseGoogleTasks,
  planSync,
  type GoogleTask,
  type GoogleTaskWriteFields,
} from "@/shared/google-tasks";
import { isRecord, toErrorMessage } from "@/shared/ipc";
import type { Todo, TodoSyncResult } from "@/shared/todo";

// "@default" is the Google Tasks API alias for the user's primary task list.
const DEFAULT_LIST = "@default";
const LIST_TOOL = "google_tasks.user.default.tasks.tasks.list";
const INSERT_TOOL = "google_tasks.user.default.tasks.tasks.insert";
const PATCH_TOOL = "google_tasks.user.default.tasks.tasks.patch";

function extractItems(data: unknown): unknown {
  if (Array.isArray(data)) return data;
  if (isRecord(data) && "items" in data) return data["items"];
  return [];
}

/** Run a full two-way sync. Never throws — a disconnected connector or a
 * failed call resolves to `{ ok:false, error }` so the caller can surface a
 * clean inline message. */
export async function syncTodosWithGoogle(): Promise<TodoSyncResult> {
  const mgr = getTodoManager();
  const local = mgr.getTodos();

  // 1. Pull. A missing connection throws here — report it as a clean failure.
  let remote: GoogleTask[];
  try {
    const data = await widgetCallTool(LIST_TOOL, {
      tasklist: DEFAULT_LIST,
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
    });
    remote = parseGoogleTasks(extractItems(data));
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }

  const plan = planSync(local, remote, Date.now(), () => crypto.randomUUID());

  // 2. Push updates to already-linked tasks. Failures are tolerated per-task:
  // a single rejected write shouldn't abort the whole sync (and the unsynced
  // edit stays "newer" locally, so the next run retries it).
  let pushed = 0;
  for (const update of plan.remoteUpdates) {
    try {
      await widgetCallTool(PATCH_TOOL, {
        tasklist: DEFAULT_LIST,
        task: update.googleTaskId,
        ...update.fields,
      });
      pushed++;
    } catch (err) {
      console.warn(`[todos] failed to push update for ${update.googleTaskId}:`, err);
    }
  }

  // 3. Create remote tasks for unlinked local todos, then link them locally so
  // the next sync matches by id instead of re-exporting.
  const links: Todo[] = [];
  const localById = new Map(local.map((t) => [t.id, t]));
  for (const create of plan.remoteCreates) {
    const source = localById.get(create.localId);
    if (!source) continue;
    try {
      const created = await insertRemote(create.fields);
      if (created) {
        links.push({
          ...source,
          googleTaskId: created.id,
          updatedAt: Date.parse(created.updated) || source.updatedAt,
        });
        pushed++;
      }
    } catch (err) {
      console.warn(`[todos] failed to export todo ${create.localId}:`, err);
    }
  }

  // 4. Apply every local change in one atomic write (imports + remote-wins
  // updates + export links; remote-deleted removals).
  mgr.applySync([...plan.localUpserts, ...links], plan.localDeletes);

  return { ok: true, pulled: plan.localUpserts.length, pushed, deleted: plan.localDeletes.length };
}

async function insertRemote(fields: GoogleTaskWriteFields): Promise<GoogleTask | null> {
  const created = await widgetCallTool(INSERT_TOOL, { tasklist: DEFAULT_LIST, ...fields });
  // insert returns the created task object; reuse the list parser on a
  // single-element array so the same validation applies.
  return parseGoogleTasks([created])[0] ?? null;
}
