// ---------------------------------------------------------------------------
// Google Tasks sync — pulls the user's default task list (fully paginated),
// reconciles it with the local todo store (last-write-wins, see
// shared/google-tasks.ts), propagates local deletes via tombstones, then
// pushes local changes back. Talks to Google through widgetCallTool (the same
// executor code-mode path the Agenda widget uses), so it needs no separate
// OAuth wiring — the connectors flow already minted the connection.
//
// Tool addresses follow the connection-scoped executor format
// <integration>.<owner>.<connection>.<api>.<resource>.<method>, mirroring the
// google_calendar.user.default.calendar.events.list address the seed widgets
// used.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

import { widgetCallTool } from "@/main/widget-actions";
import { getTodoManager } from "@/main/todos/todo-manager";
import { parseGoogleTasks, planSync, type GoogleTask } from "@/shared/google-tasks";
import { isRecord, toErrorMessage } from "@/shared/ipc";
import type { Todo, TodoSyncResult } from "@/shared/todo";

// "@default" is the Google Tasks API alias for the user's primary task list.
const DEFAULT_LIST = "@default";
const LIST_TOOL = "google_tasks.user.default.tasks.tasks.list";
const INSERT_TOOL = "google_tasks.user.default.tasks.tasks.insert";
const PATCH_TOOL = "google_tasks.user.default.tasks.tasks.patch";
const DELETE_TOOL = "google_tasks.user.default.tasks.tasks.delete";

const PAGE_SIZE = 100;
// Hard cap so a malformed nextPageToken loop can't spin forever (100 pages =
// 10k tasks, far beyond any realistic personal list).
const MAX_PAGES = 100;

function extractItems(data: unknown): unknown {
  if (Array.isArray(data)) return data;
  if (isRecord(data) && "items" in data) return data["items"];
  return [];
}

function extractNextPageToken(data: unknown): string | undefined {
  if (isRecord(data) && typeof data["nextPageToken"] === "string") return data["nextPageToken"];
  return undefined;
}

// Tolerant single-task link extractor used after an insert: we only strictly
// need the new id to link the local row (preventing a duplicate re-export on
// the next sync). `updated` is best-effort. Accepts a bare task object or one
// wrapped under a `data`/`result` envelope.
function extractInsertedId(data: unknown): { id: string; updated: string | null } | null {
  const candidate = isRecord(data) && isRecord(data["result"]) ? data["result"] : data;
  if (!isRecord(candidate)) return null;
  const id = typeof candidate["id"] === "string" ? candidate["id"] : null;
  if (!id) return null;
  return { id, updated: typeof candidate["updated"] === "string" ? candidate["updated"] : null };
}

/** Fetch every task in the default list, following nextPageToken. Throws on the
 * first failed page so the caller aborts the sync (a partial list must never
 * reach planSync — it would look like remote deletions). */
async function listAllRemoteTasks(): Promise<GoogleTask[]> {
  const all: GoogleTask[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await widgetCallTool(LIST_TOOL, {
      tasklist: DEFAULT_LIST,
      showCompleted: true,
      showHidden: true,
      maxResults: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    all.push(...parseGoogleTasks(extractItems(data)));
    pageToken = extractNextPageToken(data);
    if (!pageToken) break;
  }
  return all;
}

// Single-flight guard: a sync reads the whole todo snapshot, talks to Google,
// then writes back. Two overlapping runs (double-click, or the UI button while
// the agent's manage_todos sync runs) would each export the same unlinked
// todos and apply conflicting writes. Coalesce concurrent callers onto the one
// in-flight run so they all observe the same result.
let inFlight: Promise<TodoSyncResult> | null = null;

export function syncTodosWithGoogle(): Promise<TodoSyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Run a full two-way sync. Never throws — a disconnected connector or a failed
 * pull resolves to `{ ok:false, error }` so the caller can surface a clean
 * inline message. A pull failure aborts before any local mutation. */
async function runSync(): Promise<TodoSyncResult> {
  const mgr = getTodoManager();
  const local = mgr.getTodos();
  const tombstones = mgr.getTombstones();

  // 1. Pull the COMPLETE remote list. Any page error aborts the whole sync so
  // a truncated view can never be mistaken for remote deletions.
  let remote: GoogleTask[];
  try {
    remote = await listAllRemoteTasks();
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
  const remoteIds = new Set(remote.map((t) => t.id));

  // 2. Propagate local deletes: delete tombstoned tasks that still exist
  // remotely; clear the tombstone once gone (or already absent). A failed
  // delete keeps the tombstone so the next sync retries.
  const clearedTombstones: string[] = [];
  let deletedRemote = 0;
  for (const tomb of tombstones) {
    if (!remoteIds.has(tomb.googleTaskId)) {
      clearedTombstones.push(tomb.googleTaskId);
      continue;
    }
    try {
      await widgetCallTool(DELETE_TOOL, { tasklist: DEFAULT_LIST, task: tomb.googleTaskId });
      clearedTombstones.push(tomb.googleTaskId);
      deletedRemote++;
    } catch (err) {
      console.warn(`[todos] failed to delete remote task ${tomb.googleTaskId}:`, err);
    }
  }

  // 3. Reconcile, excluding tombstoned ids so a just-deleted item that's still
  // visible remotely (delete not yet applied) isn't re-imported.
  const tombSet = new Set(tombstones.map((t) => t.googleTaskId));
  const remoteForPlan = remote.filter((t) => !tombSet.has(t.id));
  const plan = planSync(local, remoteForPlan, Date.now(), () => crypto.randomUUID());

  // 4. Push updates to already-linked tasks. Per-task failures are tolerated:
  // the unsynced edit stays "newer" locally, so the next run retries it.
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

  // 5. Create remote tasks for unlinked local todos, then link them locally so
  // the next sync matches by id instead of re-exporting (avoiding duplicates).
  const links: Todo[] = [];
  const localById = new Map(local.map((t) => [t.id, t]));
  for (const create of plan.remoteCreates) {
    const source = localById.get(create.localId);
    if (!source) continue;
    try {
      const created = await widgetCallTool(INSERT_TOOL, {
        tasklist: DEFAULT_LIST,
        ...create.fields,
      });
      const link = extractInsertedId(created);
      if (link) {
        links.push({
          ...source,
          googleTaskId: link.id,
          updatedAt: link.updated ? Date.parse(link.updated) || source.updatedAt : source.updatedAt,
        });
        pushed++;
      } else {
        console.warn(`[todos] insert for ${create.localId} returned no id; not linked`);
      }
    } catch (err) {
      console.warn(`[todos] failed to export todo ${create.localId}:`, err);
    }
  }

  // 6. Apply every local change in one atomic write, then drop settled
  // tombstones.
  mgr.applySync([...plan.localUpserts, ...links], plan.localDeletes);
  mgr.clearTombstones(clearedTombstones);

  return { ok: true, pulled: plan.localUpserts.length, pushed, deleted: deletedRemote };
}
