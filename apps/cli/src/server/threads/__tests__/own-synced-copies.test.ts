import path from "node:path";
import { createConnection } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { listStoredThreadEvents } from "@repo/db/events";
import { runMigrations } from "@repo/db/migrate";
import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it } from "vitest";
import { ThreadService } from "../service";
import { unavailableTurnDriver } from "../turn-driver";
import { makeTempDir } from "../../__tests__/temp-dir";
import { pathOnlyOrigins } from "../../__tests__/path-only-origins";

// a new service on the same db is a process restart; the constructor alone writes nothing.
const openService = (db: DbConnection): ThreadService =>
  new ThreadService({
    createTurnDriver: () => unavailableTurnDriver,
    db,
    notifier: noopNotifier,
    origins: pathOnlyOrigins,
  });

describe("removing this install's own rows pulled back from the log at boot", () => {
  it("settles a thread a copy's turn/started left running on a turn that had finished", async () => {
    const db = createConnection(path.join(makeTempDir("inteligir-own-copies-"), "test.db"));
    runMigrations(db);
    const earlier = openService(db);
    const { id: threadId } = await earlier.create({});
    const scope = turnScope("turn_mine");
    const started: ThreadEvent = { scope, threadId, type: "turn/started" };
    const completed: ThreadEvent = { scope, status: "completed", threadId, type: "turn/completed" };
    earlier.ingestProviderEvents(threadId, [started, completed]);
    // signed out mid-turn: the start was pushed under the earlier id and the end was not, so
    // signing in again pulled back the start alone.
    earlier.applySyncedEvents({
      cursor: 1,
      rows: [{ event: started, origin: { deviceId: "dev_before", deviceSeq: 0 } }],
      threadId,
    });
    const wedged = await earlier.get(threadId);
    expect(wedged?.thread.status).toBe("active");

    openService(db).boot();

    const detail = await openService(db).get(threadId);
    expect(detail?.thread.status).toBe("idle");
    expect(detail?.thread.activeTurnId).toBeNull();
    expect(listStoredThreadEvents(db, { threadId }).map((row) => row.event)).toEqual([
      started,
      completed,
    ]);
  });
});
