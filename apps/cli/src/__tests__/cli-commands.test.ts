import { spawnSync } from "node:child_process";
import path from "node:path";
import { browserHandoffUrl } from "@repo/contract/local/routes";
import type { ThreadTimeline } from "@repo/contract/local/thread-timeline";
import type { ApprovalPendingInteractionPayload } from "@repo/domain/pending-interactions";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  FIXTURE_HANDOFF_NONCE,
  makeFixtureState,
  makeInteraction,
  makeThread,
  serveFixture,
  EMPTY_TIMELINE,
} from "./fixture-server";
import type { FixtureServer, FixtureState } from "./fixture-server";
import { runCliForTest } from "./run-cli";

const BIN = path.resolve(import.meta.dirname, "..", "..", "bin", "inteligir");

const boxedLines = (stdout: string): string[] =>
  stdout
    .split("\n")
    .filter((line) => line.startsWith(" │"))
    .map((line) => line.replace(/^ │\s*/u, "").replace(/\s*│$/u, ""))
    .filter((line) => line.length > 0);

const boot = async (state: FixtureState): Promise<FixtureServer> => {
  const server = await serveFixture(state);
  onTestFinished(async () => {
    await server.close();
  });
  return server;
};

const seededState = (): FixtureState => makeFixtureState();

const SHOW_TIMELINE: ThreadTimeline = {
  maxSequence: 3,
  rows: [
    {
      contextPaths: [],
      createdAt: 1_700_000_000_001,
      id: "user:1",
      kind: "conversation",
      role: "user",
      sourceSeqEnd: 1,
      sourceSeqStart: 1,
      text: "Write me a note",
      threadId: "thr_1",
      turnId: null,
      viewContext: null,
    },
    {
      children: [
        {
          approvalStatus: null,
          changes: [{ diff: null, kind: "add", movePath: null, path: "notes/a.md" }],
          createdAt: 1_700_000_000_002,
          id: "item:turn_1:file",
          kind: "work",
          sourceSeqEnd: 2,
          sourceSeqStart: 2,
          status: "completed",
          threadId: "thr_1",
          turnId: "turn_1",
          workKind: "file-change",
        },
      ],
      completedAt: 1_700_000_000_005,
      createdAt: 1_700_000_000_002,
      id: "turn:turn_1",
      kind: "turn",
      sourceSeqEnd: 3,
      sourceSeqStart: 2,
      status: "completed",
      threadId: "thr_1",
      turnId: "turn_1",
    },
    {
      contextPaths: [],
      createdAt: 1_700_000_000_003,
      id: "item:turn_1:msg",
      kind: "conversation",
      role: "assistant",
      sourceSeqEnd: 3,
      sourceSeqStart: 3,
      text: "Done",
      threadId: "thr_1",
      turnId: "turn_1",
      viewContext: null,
    },
  ],
  tokenUsage: null,
};

const COMMAND_APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "allow_for_session"],
  kind: "approval",
  reason: "installs the dependencies",
  subject: { command: "npm install", cwd: "/fixture/project", itemId: "cmd_1", kind: "command" },
};

const FILE_APPROVAL: ApprovalPendingInteractionPayload = {
  availableDecisions: ["allow_once", "deny"],
  kind: "approval",
  reason: null,
  subject: { itemId: "file_1", kind: "file_change", writeScope: null },
};

describe("action commands", () => {
  it("lists threads and shows one with the compact timeline", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [],
      thread: makeThread({ id: "thr_1", status: "idle", title: "Note writing" }),
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);

    const list = await runCliForTest({ argv: ["action", "list"], baseUrl: server.baseUrl });
    expect(list.stdout).toBe("thr_1  idle  Note writing\n");

    const show = await runCliForTest({
      argv: ["action", "show", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(show.code).toBe(0);
    expect(show.stdout).toBe(
      [
        "Thread thr_1 — idle",
        "Title: Note writing",
        "",
        "── user ──",
        "Write me a note",
        "",
        "── turn (completed) ──",
        "  ~ add notes/a.md",
        "",
        "── agent ──",
        "Done",
        "",
      ].join("\n"),
    );
  });

  it("shows what a pending approval would allow", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        makeInteraction({ id: "int_cmd", payload: COMMAND_APPROVAL, threadId: "thr_1" }),
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const show = await runCliForTest({
      argv: ["action", "show", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(show.stdout).toBe(
      [
        "Thread thr_1 — active",
        "Pending interactions:",
        "  int_cmd  thr_1  pending",
        "    $ npm install (in /fixture/project) — installs the dependencies",
        "    answer: allow_once, allow_for_session, deny",
        "",
      ].join("\n"),
    );
  });

  it("creates a thread and sends the first turn", async () => {
    const state = seededState();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["action", "new", "Summarize my inbox"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Action thr_created_1\n✔ Turn turn_for_thr_created_1 started\n");
  });

  it("sends follow-ups and archives", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [],
      thread: makeThread({ id: "thr_1" }),
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);
    const send = await runCliForTest({
      argv: ["action", "send", "thr_1", "and then?"],
      baseUrl: server.baseUrl,
    });
    expect(send.stdout).toBe("✔ Turn turn_for_thr_1 started\n");

    const archive = await runCliForTest({
      argv: ["action", "archive", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(archive.stdout).toBe("✔ Archived thr_1\n");
  });

  it("stops a running action, and says so when there is nothing to stop", async () => {
    const state = seededState();
    state.threads.push(
      {
        pendingInteractions: [],
        thread: makeThread({ activeTurnId: "turn_1", id: "thr_1", status: "active" }),
        timeline: SHOW_TIMELINE,
      },
      { pendingInteractions: [], thread: makeThread({ id: "thr_2" }), timeline: EMPTY_TIMELINE },
    );
    const server = await boot(state);
    const stop = await runCliForTest({
      argv: ["action", "stop", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(stop.code).toBe(0);
    expect(stop.stdout).toBe("✔ Stopping thr_1\n");

    const idle = await runCliForTest({
      argv: ["action", "stop", "thr_2", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(JSON.parse(idle.stdout)).toMatchObject({ stop: "not-running", thread: { id: "thr_2" } });

    const missing = await runCliForTest({
      argv: ["action", "stop", "thr_missing"],
      baseUrl: server.baseUrl,
    });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
  });
});

describe("interactions commands", () => {
  it("lists across threads and answers by scanning for the owner", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        {
          createdAt: 1_700_000_000_000,
          id: "int_1",
          payload: null,
          requestKey: "req_1",
          resolution: null,
          resolvedAt: null,
          status: "pending",
          threadId: "thr_1",
          turnId: "turn_1",
        },
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: SHOW_TIMELINE,
    });
    const server = await boot(state);

    const list = await runCliForTest({
      argv: ["interactions", "list"],
      baseUrl: server.baseUrl,
    });
    expect(list.stdout).toBe("int_1  thr_1  pending\n  (no details)\n");

    const answer = await runCliForTest({
      argv: ["interactions", "answer", "int_1", "allow_once"],
      baseUrl: server.baseUrl,
    });
    expect(answer.code).toBe(0);
    expect(answer.stdout).toBe("✔ Interaction int_1 resolved\n");
  });

  it("says what each approval would allow, and the answers it takes, before anyone answers", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        makeInteraction({ id: "int_cmd", payload: COMMAND_APPROVAL, threadId: "thr_1" }),
        makeInteraction({ id: "int_file", payload: FILE_APPROVAL, threadId: "thr_1" }),
      ],
      thread: makeThread({ id: "thr_1", status: "active" }),
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const list = await runCliForTest({
      argv: ["interactions", "list"],
      baseUrl: server.baseUrl,
    });
    expect(list.stdout).toBe(
      [
        "int_cmd  thr_1  pending",
        "  $ npm install (in /fixture/project) — installs the dependencies",
        "  answer: allow_once, allow_for_session, deny",
        "int_file  thr_1  pending",
        "  write unscoped",
        "  answer: allow_once, deny",
        "",
      ].join("\n"),
    );
  });
});

describe("status and help", () => {
  it("renders system status", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({ argv: ["status"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    // the consola box's width follows its widest line and the port is random, so only the rows are pinned.
    expect(boxedLines(result.stdout)).toEqual([
      `inteligir 9.9.9-fixture — ${server.baseUrl}`,
      "Data dir: /fixture/data",
      "Schema: v3 — uptime 65s",
      "Agent: unavailable (mode auto)",
    ]);
  });

  it("prints the env context in --help", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({ argv: ["--help"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("INTELIGIR_DATA_DIR");
  });

  it("names where an unset data dir derives from, installed or in a checkout", async () => {
    const server = await boot(seededState());
    const installed = await runCliForTest({
      argv: ["--help"],
      baseUrl: server.baseUrl,
      env: { NODE_ENV: "production" },
    });
    expect(installed.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived under ~/.inteligir)");

    const checkout = await runCliForTest({ argv: ["--help"], baseUrl: server.baseUrl });
    expect(checkout.stdout).toContain("INTELIGIR_DATA_DIR: (unset — derived from this checkout)");
  });
});

const recordingOpener = (answer: boolean) => {
  const opened: string[] = [];
  const openExternalUrl = async (url: string): Promise<boolean> => {
    opened.push(url);
    return answer;
  };
  return { openExternalUrl, opened };
};

describe("open", () => {
  it("opens a link the server minted and names the server, never the nonce", async () => {
    const server = await boot(seededState());
    const browser = recordingOpener(true);
    const result = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(browser.opened).toEqual([
      browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE),
    ]);
    expect(result.stdout).toContain(server.baseUrl);
    expect(result.stdout).not.toContain(FIXTURE_HANDOFF_NONCE);
  });

  it("prints the link when no browser opens", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: recordingOpener(false).openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `${browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE)}\n`,
    );
  });

  it("prints the link under --json and opens nothing", async () => {
    const server = await boot(seededState());
    const browser = recordingOpener(true);
    const result = await runCliForTest({
      argv: ["open", "--json"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(result.code).toBe(0);
    expect(browser.opened).toEqual([]);
    expect(JSON.parse(result.stdout)).toEqual({
      url: browserHandoffUrl(`${server.baseUrl}/`, FIXTURE_HANDOFF_NONCE),
    });
  });

  it("hands out no link from a server with no UI, saying why, and NOT_FOUND under --json", async () => {
    const state = seededState();
    state.servesUi = false;
    const server = await boot(state);
    const browser = recordingOpener(true);
    const human = await runCliForTest({
      argv: ["open"],
      baseUrl: server.baseUrl,
      openExternalUrl: browser.openExternalUrl,
    });
    expect(human.code).toBe(1);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("serves no UI");
    expect(browser.opened).toEqual([]);

    const json = await runCliForTest({ argv: ["open", "--json"], baseUrl: server.baseUrl });
    expect(json.code).toBe(1);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "This server serves no UI (an unbuilt checkout).",
    });
  });
});

const withThread = (id: string): FixtureState => {
  const state = seededState();
  state.threads.push({
    pendingInteractions: [],
    thread: makeThread({ id }),
    timeline: EMPTY_TIMELINE,
  });
  return state;
};

describe("argv the CLI refuses", () => {
  it("names an undeclared flag instead of ignoring it", async () => {
    const server = await boot(withThread("thr_1"));
    const result = await runCliForTest({
      argv: ["action", "send", "thr_1", "hello", "--textt"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unknown option: --textt");
  });

  it("reports an undeclared flag as INVALID_USAGE under --json", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["status", "--nope", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: --nope",
    });
  });

  it("refuses a flag written before the command's name, which the leaf would never read", async () => {
    const server = await boot(withThread("thr_1"));
    const leading = await runCliForTest({
      argv: ["--json", "action", "show", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(leading.code).toBe(1);
    expect(leading.stdout).toBe("");
    expect(JSON.parse(leading.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "put flags after the command's name: inteligir <command> … --flag",
    });

    const between = await runCliForTest({
      argv: ["action", "--running", "list"],
      baseUrl: server.baseUrl,
    });
    expect(between.code).toBe(1);
    expect(between.stdout).toBe("");
    expect(between.stderr).toContain("put flags after the command's name");
  });

  it("names a missing positional rather than acting on undefined", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({ argv: ["action", "show"], baseUrl: server.baseUrl });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ID");
  });

  it("refuses a word past the last positional instead of dropping it", async () => {
    const server = await boot(withThread("thr_1"));
    const result = await runCliForTest({
      argv: ["action", "show", "thr_1", "b", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unexpected argument: b — quote a value that contains spaces",
    });
  });

  it("names an undeclared short flag instead of reading it as a boolean", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["action", "list", "-n", "5", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "unknown option: -n",
    });
  });

  it("checks only the words before `--`, so a dash-led name after it is an operand", async () => {
    const server = await boot(withThread("-draft"));
    const result = await runCliForTest({
      argv: ["action", "show", "--", "-draft"],
      baseUrl: server.baseUrl,
    });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("Thread -draft — idle\n");
  });

  it("counts every word after `--` as an operand, so one past the leaf's arity is refused", async () => {
    const server = await boot(withThread("thr_1"));
    for (const operands of [
      ["thr_1", "--", "b"],
      ["--", "thr_1", "b"],
    ]) {
      const result = await runCliForTest({
        argv: ["action", "show", "--json", ...operands],
        baseUrl: server.baseUrl,
      });
      expect(result.code, operands.join(" ")).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: "INVALID_USAGE",
        message: "unexpected argument: b — quote a value that contains spaces",
      });
    }
  });

  it("refuses a verb this build no longer has as an unknown command", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["vault", "list", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "Unknown command vault",
    });
  });

  it("hands a dash-led value to the flag that takes one", async () => {
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--timeout", "-5", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: '--timeout must be a number above 0 and at most 86400 (got "-5")',
    });
  });
});

describe("a leaf refuses bad usage before it resolves a server", () => {
  it("action list checks its --limit first", async () => {
    const result = await runCliForTest({
      argv: ["action", "list", "--limit", "0", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("action wait refuses a timeout past what a node timer can hold", async () => {
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--timeout", "86401", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: '--timeout must be a number above 0 and at most 86400 (got "86401")',
    });
  });

  it("action wait refuses a poll interval over a minute", async () => {
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--poll-interval", "60001", "--json"],
      baseUrl: null,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });
});

describe("action new never orphans a thread silently", () => {
  it("names the created thread when its first turn fails", async () => {
    const state = seededState();
    const server = await boot(state);
    state.refuseSend = { code: "PROVIDER_UNAVAILABLE", message: "no agent" };
    const result = await runCliForTest({
      argv: ["action", "new", "do a thing"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("thr_created_1");
    expect(result.stderr).toContain("was created but its first turn failed");
    expect(result.stderr).toContain("inteligir action send thr_created_1");
  });
});

describe("interactions answer validates the resolution locally", () => {
  it("refuses a decision the request never offered, naming the ones it did", async () => {
    const state = seededState();
    state.threads.push({
      pendingInteractions: [
        {
          createdAt: 1_700_000_000_000,
          id: "int_a",
          payload: {
            availableDecisions: ["allow_once", "deny"],
            kind: "approval",
            reason: null,
            subject: {
              command: "rm -rf /",
              cwd: null,
              itemId: "cmd_1",
              kind: "command",
            },
          },
          requestKey: "req_a",
          resolution: null,
          resolvedAt: null,
          status: "pending",
          threadId: "thr_a",
          turnId: "turn_a",
        },
      ],
      thread: makeThread({ id: "thr_a", status: "active" }),
      timeline: EMPTY_TIMELINE,
    });
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["interactions", "answer", "int_a", "allow_for_session"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("allow_once, deny");
    expect(state.threads.at(-1)?.pendingInteractions[0]?.status).toBe("pending");
  });
});

describe("cloud login", () => {
  it("reads the password from stdin under `--password -`, one line and its newline", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "Owner@Example.test", "--password", "-", "--json"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode("correct horse battery\n"),
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      accountEmail: "owner@example.test",
      state: "signed-in",
    });
  });

  it("refuses to prompt under --json — the agent path has no terminal to wait on", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "INVALID_USAGE" });
  });

  it("refuses an empty stdin rather than sending an empty password", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test", "--password", "-"],
      baseUrl: server.baseUrl,
      stdin: new TextEncoder().encode("\n"),
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("stdin carried no password");
  });

  it("resolves the server before prompting, so no password is typed for nothing", async () => {
    const result = await runCliForTest({
      argv: ["cloud", "login", "--email", "owner@example.test"],
      baseUrl: null,
      stdin: "terminal",
    });
    expect(result.code).toBe(3);
    expect(result.stderr).not.toContain("Password:");
  });
});

describe("cloud status", () => {
  it("says how many events never reached the cloud", async () => {
    const state = seededState();
    state.cloud = {
      accountEmail: "owner@example.test",
      cloudUrl: "https://cloud.test",
      connected: true,
      cursor: 4,
      deviceId: "dev_1",
      dropped: 2,
      lastError: null,
      lastSyncedAt: null,
      pending: 0,
      state: "signed-in",
    };
    const server = await boot(state);
    const result = await runCliForTest({ argv: ["cloud", "status"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("2 events never reached the cloud");
  });

  it("sends a device its sign-out could not remove to the devices page", async () => {
    const state = seededState();
    state.cloud = {
      cloudUrl: "https://cloud.test",
      revokeError: "Could not reach the cloud: HTTP 503",
      state: "signed-out",
    };
    const server = await boot(state);
    const result = await runCliForTest({ argv: ["cloud", "status"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("HTTP 503");
    expect(result.stdout).toContain("https://cloud.test/app/devices");
  });
});

describe("--json failures", () => {
  it("puts the error envelope on stderr and leaves stdout empty", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["action", "show", "thr_missing", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: "NOT_FOUND",
      message: "Not found",
    });
  });

  it("reports a local usage refusal with a CLI-side class", async () => {
    const server = await boot(seededState());
    const result = await runCliForTest({
      argv: ["action", "wait", "thr_1", "--timeout", "nope", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: '--timeout must be a number above 0 and at most 86400 (got "nope")',
    });
  });
});

// citty picks colour once, at import, and vitest's TEST turns it off, so only a fresh process without the
// no-colour signals shows what a pipe would receive.
describe("citty's colour stays out of what a pipe receives", () => {
  const ESC = String.fromCodePoint(0x1b);
  const NO_COLOUR_SIGNALS = new Set(["CI", "NO_COLOR", "TEST"]);
  const runBin = (argv: string[]) =>
    spawnSync(process.execPath, [BIN, ...argv], {
      encoding: "utf-8",
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !NO_COLOUR_SIGNALS.has(name)),
        ),
        TERM: "xterm-256color",
      },
      timeout: 60_000,
    });

  it("keeps the --json envelope free of escapes", () => {
    const result = runBin(["actoin", "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      error: "INVALID_USAGE",
      message: "Unknown command actoin",
    });
  });

  it("prints usage without escapes", () => {
    const help = runBin(["action", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("USAGE");
    expect(help.stdout).not.toContain(ESC);

    const bare = runBin([]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("USAGE");
    expect(bare.stderr).not.toContain(ESC);
  });
});

describe("a server that stopped answering", () => {
  it("classifies a refused dial as SERVER_UNREACHABLE / exit 3", async () => {
    // boot then close: a real bound port with nothing listening, the state a stale server.json leaves.
    const server = await serveFixture(makeFixtureState());
    const { baseUrl } = server;
    await server.close();
    const result = await runCliForTest({ argv: ["status", "--json"], baseUrl });
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: "SERVER_UNREACHABLE" });
  });
});
