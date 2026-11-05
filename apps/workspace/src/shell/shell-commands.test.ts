// @vitest-environment jsdom

import { emit } from "@tauri-apps/api/event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { APP_COMMANDS, UPDATE_STATE_EVENT } from "./ipc-contract";
import type { UpdateState } from "./update-state";
import {
  shellConfig,
  shellReplicaSql,
  shellStagedBlobs,
  shellUpdates,
  underShell,
} from "./shell-commands";
import { ShellError } from "./shell-error";
import { clearShell, mockShell, reply, replyBytes } from "./test-support/mock-shell";

afterEach(clearShell);

const IDLE: UpdateState = { checkedAt: null, currentVersion: "0.6.0", status: "idle" };
const SHA = "a".repeat(64);

// what the shell rejects with when it cannot do what it was asked (src-tauri/src/error.rs)
const shellRefuses = async (kind: string, message: string): Promise<never> =>
  // oxlint-disable-next-line prefer-promise-reject-errors -- the shell rejects with its serialized error, a plain object, which is what this stands in for
  await Promise.reject({ kind, message });

describe("the shell's door", () => {
  it("is shut outside the shell", () => {
    expect(underShell()).toBe(false);
    mockShell();
    expect(underShell()).toBe(true);
  });

  it("asks the row's command, and hands back the parsed answer", async () => {
    const asked = vi.fn<() => UpdateState>(() => IDLE);
    mockShell(reply(APP_COMMANDS.updates.getState)(asked));
    expect(await shellUpdates.getState()).toEqual(IDLE);
    expect(asked).toHaveBeenCalledOnce();
  });

  it("rejects an answer its row does not parse", async () => {
    mockShell({
      answer: () => ({ checkedAt: null, currentVersion: "0.6.0", status: "rebooting" }),
      command: APP_COMMANDS.updates.getState.command,
    });
    await expect(shellUpdates.getState()).rejects.toBeInstanceOf(ZodError);
  });

  it("reads a command the shell cannot carry out as its error, kind and words", async () => {
    mockShell({
      answer: async () => await shellRefuses("keychain", "The Keychain refused: locked"),
      command: APP_COMMANDS.config.command,
    });
    await expect(shellConfig()).rejects.toEqual(
      new ShellError("keychain", "The Keychain refused: locked"),
    );
  });

  it("reads a command no capability grants as the bridge's fault", async () => {
    mockShell();
    await expect(shellUpdates.check()).rejects.toMatchObject({
      kind: "bridge",
      name: "ShellError",
    });
  });

  it("hands a listener only the frames its row parses", async () => {
    mockShell();
    const heard: UpdateState[] = [];
    const stop = shellUpdates.onState((state) => {
      heard.push(state);
    });
    await emit(UPDATE_STATE_EVENT.event, { ...IDLE, status: "rebooting" });
    await emit(UPDATE_STATE_EVENT.event, IDLE);
    stop();
    expect(heard).toEqual([IDLE]);
  });
});

// the shell's side of a transaction: what it was sent, and what it holds once committed
const shellReplica = () => {
  const sent: string[] = [];
  const committed: string[] = [];
  let open: string[] | null = null;
  let nextToken = 1;
  mockShell(
    reply(APP_COMMANDS.replica.all)(({ sql }) => {
      sent.push(`all ${sql}`);
      return committed.map((body) => ({ body }));
    }),
    reply(APP_COMMANDS.replica.run)(({ params, sql }) => {
      sent.push(`run ${sql}`);
      committed.push(String(params[0]));
      return null;
    }),
    reply(APP_COMMANDS.replica.begin)(() => {
      sent.push("begin");
      open = [];
      nextToken += 1;
      return nextToken;
    }),
    reply(APP_COMMANDS.replica.txRun)(({ params, token }) => {
      sent.push(`tx ${String(token)}`);
      open?.push(String(params[0]));
      return null;
    }),
    reply(APP_COMMANDS.replica.txAll)(() =>
      [...committed, ...(open ?? [])].map((body) => ({ body })),
    ),
    reply(APP_COMMANDS.replica.commit)(({ token }) => {
      sent.push(`commit ${String(token)}`);
      committed.push(...(open ?? []));
      open = null;
      return null;
    }),
    reply(APP_COMMANDS.replica.rollback)(({ token }) => {
      sent.push(`rollback ${String(token)}`);
      open = null;
      return null;
    }),
  );
  return { committed, sent };
};

describe("the Mac's replica over the door", () => {
  it("commits what an exclusive run wrote, under the token the shell opened", async () => {
    const { committed, sent } = shellReplica();
    const sql = shellReplicaSql();
    const seen = await sql.exclusive(async (tx) => {
      await tx.run("INSERT INTO notes VALUES (?)", ["one"]);
      return await tx.all("SELECT body FROM notes", []);
    });
    expect(seen).toEqual([{ body: "one" }]);
    expect(committed).toEqual(["one"]);
    expect(sent).toEqual(["begin", "tx 2", "commit 2"]);
  });

  it("rolls back what a failed exclusive run wrote, and hands on its failure", async () => {
    const { committed, sent } = shellReplica();
    const sql = shellReplicaSql();
    const failed = sql.exclusive(async (tx) => {
      await tx.run("INSERT INTO notes VALUES (?)", ["lost"]);
      throw new Error("the plan stopped");
    });
    await expect(failed).rejects.toThrow("the plan stopped");
    expect(committed).toEqual([]);
    expect(sent).toEqual(["begin", "tx 2", "rollback 2"]);
  });

  it("holds a statement asked during a transaction until the transaction ends", async () => {
    const { sent } = shellReplica();
    const sql = shellReplicaSql();
    const inside = Promise.withResolvers<null>();
    const running = sql.exclusive(async (tx) => {
      await tx.run("INSERT INTO notes VALUES (?)", ["one"]);
      await inside.promise;
    });
    const outside = sql.run("INSERT INTO notes VALUES (?)", ["two"]);
    await vi.waitFor(() => {
      expect(sent).toContain("tx 2");
    });
    expect(sent).not.toContain("run INSERT INTO notes VALUES (?)");
    inside.resolve(null);
    await running;
    await outside;
    expect(sent).toEqual(["begin", "tx 2", "commit 2", "run INSERT INTO notes VALUES (?)"]);
  });
});

describe("the outbox's staged files over the door", () => {
  it("stages bytes raw, reads them back, and reads a file the shell no longer holds as gone", async () => {
    const staged = new Map<string, Uint8Array>();
    mockShell(
      replyBytes(APP_COMMANDS.files.stage)((bytes) => {
        staged.set(SHA, bytes);
        return null;
      }),
      reply(APP_COMMANDS.files.staged)(async ({ sha }) => {
        const bytes = staged.get(sha);
        return bytes === undefined
          ? await shellRefuses("missing", "This Mac does not hold that file.")
          : new Uint8Array(bytes).buffer;
      }),
    );
    const blobs = shellStagedBlobs();
    await blobs.put(SHA, new Uint8Array([1, 2, 3]), "application/pdf");
    expect(await blobs.read(SHA)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await blobs.read("b".repeat(64))).toBeNull();
  });
});
