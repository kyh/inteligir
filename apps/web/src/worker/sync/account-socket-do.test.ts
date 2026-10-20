import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dropRetiredTables } from "./account-socket-do";

const tablesOf = (storage: DurableObjectStorage): string[] =>
  storage.sql
    .exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    )
    .toArray()
    .map((row) => row.name);

describe("the account socket under the retired thread log's class name", () => {
  it("drops a table the thread log left, with its rows", async () => {
    const stub = env.ACCOUNT_SOCKET.getByName("user:retired-log");
    const left = await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("CREATE TABLE thread_events (seq INTEGER PRIMARY KEY, body TEXT)");
      state.storage.sql.exec("INSERT INTO thread_events (body) VALUES ('a turn')");
      await dropRetiredTables(state.storage);
      return tablesOf(state.storage);
    });
    expect(left).toEqual([]);
  });

  it("leaves an object that holds nothing as it is", async () => {
    const stub = env.ACCOUNT_SOCKET.getByName("user:fresh");
    const left = await runInDurableObject(stub, async (_instance, state) => {
      await dropRetiredTables(state.storage);
      return tablesOf(state.storage);
    });
    expect(left).toEqual([]);
  });
});
