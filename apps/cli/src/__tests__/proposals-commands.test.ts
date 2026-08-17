// `inteligir proposals …` against the served contract app: the human
// renderings byte for byte, and the two properties that make the verbs safe
// for an agent to drive — the revision is READ rather than typed, and a
// refusal never prints as an answer.

import { afterEach, describe, expect, it } from "vitest";
import {
  makeFixtureState,
  makeProposal,
  serveFixture,
  type FixtureServer,
  type FixtureState,
} from "./fixture-server";
import { runCliForTest } from "./run-cli";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function boot(state: FixtureState): Promise<FixtureServer> {
  const server = await serveFixture(state);
  cleanups.push(() => server.close());
  return server;
}

function seeded(): FixtureState {
  const state = makeFixtureState();
  state.proposals = [
    makeProposal({ id: "prp_1" }),
    makeProposal({ id: "prp_2", docPath: "notes/other.md", threadId: "thr_2", status: "stale" }),
  ];
  return state;
}

describe("proposals list", () => {
  it("prints one line per suggestion: id, status, path, shape", async () => {
    const server = await boot(seeded());
    const result = await runCliForTest({ argv: ["proposals", "list"], baseUrl: server.baseUrl });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "prp_1  pending  notes/hello.md  1 hunk(s)",
        "prp_2  stale  notes/other.md  1 hunk(s)",
        "",
      ].join("\n"),
    );
  });

  it("narrows by doc and by thread", async () => {
    const server = await boot(seeded());
    const byDoc = await runCliForTest({
      argv: ["proposals", "list", "--doc", "notes/other.md"],
      baseUrl: server.baseUrl,
    });
    expect(byDoc.stdout).toBe("prp_2  stale  notes/other.md  1 hunk(s)\n");

    const byThread = await runCliForTest({
      argv: ["proposals", "list", "--thread", "thr_1"],
      baseUrl: server.baseUrl,
    });
    expect(byThread.stdout).toBe("prp_1  pending  notes/hello.md  1 hunk(s)\n");
  });

  it("answers JSON on stdout under --json", async () => {
    const server = await boot(seeded());
    const result = await runCliForTest({
      argv: ["proposals", "list", "--json"],
      baseUrl: server.baseUrl,
    });
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ proposals: [{ id: "prp_1" }, { id: "prp_2" }] });
  });
});

describe("proposals show", () => {
  it("prints a unified diff whose hunk headers carry the index --hunk names", async () => {
    const server = await boot(seeded());
    const result = await runCliForTest({
      argv: ["proposals", "show", "prp_1"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      [
        "prp_1  pending  notes/hello.md  1 hunk(s)",
        "--- a/notes/hello.md",
        "+++ b/notes/hello.md",
        "@@ hunk 0 -1,1 +1,1 @@",
        "-# Hello",
        "+# Hello there",
        "",
      ].join("\n"),
    );
  });

  it("says a stale suggestion cannot be applied, above its diff", async () => {
    const server = await boot(seeded());
    const result = await runCliForTest({
      argv: ["proposals", "show", "prp_2"],
      baseUrl: server.baseUrl,
    });
    expect(result.stdout).toContain("(stale — the file changed after this was written");
  });

  it("describes a deletion instead of printing an empty diff", async () => {
    const state = seeded();
    state.proposals = [makeProposal({ id: "prp_del", proposedContent: null, hunks: [] })];
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["proposals", "show", "prp_del"],
      baseUrl: server.baseUrl,
    });
    expect(result.stdout).toContain("(this suggestion deletes notes/hello.md)");
  });

  it("exits non-zero on an id the server does not have", async () => {
    const server = await boot(seeded());
    const result = await runCliForTest({
      argv: ["proposals", "show", "prp_missing"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Suggestion not found");
  });
});

describe("the review verbs", () => {
  it("accept reads the revision itself, so a caller cannot name a stale one", async () => {
    const state = seeded();
    // The fixture's guard refuses anything but the row's own revision; the
    // command never takes one as an argument, so this can only pass if it
    // fetched first.
    state.proposals = [makeProposal({ id: "prp_1", revision: 17 })];
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["proposals", "accept", "prp_1"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("prp_1 accepted\n");
  });

  it("reject settles the row and touches no file", async () => {
    const state = seeded();
    state.vault.set("notes/hello.md", "# Hello\n");
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["proposals", "reject", "prp_1"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("prp_1 rejected\n");
    expect(state.vault.get("notes/hello.md")).toBe("# Hello\n");
  });

  it("refuses a --hunk that is not a hunk index, and resolves nothing", async () => {
    const state = seeded();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["proposals", "accept", "prp_1", "--hunk", "first"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--hunk must be a hunk index");
    expect(state.proposals[0]?.status).toBe("pending");
  });

  it("passes --hunk through, and answers JSON on stdout under --json", async () => {
    const state = seeded();
    const server = await boot(state);
    const result = await runCliForTest({
      argv: ["proposals", "accept", "prp_1", "--hunk", "0", "--json"],
      baseUrl: server.baseUrl,
    });
    expect(result.code).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ proposal: { id: "prp_1", status: "accepted" } });
  });
});
