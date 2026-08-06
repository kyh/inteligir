// ---------------------------------------------------------------------------
// The agent's granted capabilities, driven the way the container drives them.
//
// Every case here goes through `executeAgentTool` over a REAL vault manifest,
// a REAL knowledge index and a REAL snapshot store inside a Durable Object.
// That placement is the thing under test as much as the answers are: the tools
// are implemented host-side precisely so a container cannot skip a confirmation
// or widen the surface, and a suite that called the vault directly would prove
// nothing about that.
// ---------------------------------------------------------------------------

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { AGENT_GRANTS } from "@repo/bridge/agent-grants";
import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";

import {
  agentToolManifest,
  agentToolNames,
  executeAgentTool,
  type AgentToolContext,
} from "../agent/agent-tools";
import { userHostName } from "../host/host-address";
import type { UserHost } from "../host/user-host";

type ToolRun = (name: string, args: unknown) => Promise<{ isError: boolean; text: string }>;

/** A tool executor over one object's real vault and index. `confirm` is
 * supplied per case, because "what happens when the user says no" is half of
 * what the destructive tier means; `attended` is the lane, because the other
 * half is what an unattended run may not reach at all. */
function withTools<T>(
  name: string,
  confirm: (proposal: Omit<AgentConfirmationRequest, "id">) => Promise<boolean>,
  run: (ctx: { host: UserHost; call: ToolRun }) => Promise<T>,
  attended = true,
): Promise<T> {
  const stub = env.UserHost.getByName(userHostName(name));
  return runInDurableObject(stub, async (host) => {
    // The object's OWN snapshot store, index and delegation queue — a second
    // composition would put the restore points somewhere the production path
    // never looks.
    const context: AgentToolContext = {
      vault: host.vault,
      knowledge: host.knowledge,
      snapshots: host.agent.snapshots,
      delegations: host.agent.delegations,
      scope: { origin: "chat", ref: host.agent.chat.activeSessionId() },
      turnId: "turn-under-test",
      attended,
      confirm,
    };
    return run({ host, call: (tool, args) => executeAgentTool(context, tool, args) });
  });
}

const always = (): Promise<boolean> => Promise.resolve(true);

describe("the agent's tool surface", () => {
  it("takes every model-facing sentence from the grant table", () => {
    const manifest = agentToolManifest(true);
    for (const tool of manifest) {
      const grant = AGENT_GRANTS.find((row) => row.agentName === tool.name);
      expect(grant, `${tool.name} has no grant row`).toBeDefined();
      expect(tool.description.startsWith(grant?.description ?? "")).toBe(true);
    }
  });

  it("implements every capability the grant table declares", () => {
    const implemented = new Set(agentToolNames());
    const missing = AGENT_GRANTS.map((row) => row.agentName).filter(
      (name) => !implemented.has(name),
    );
    // A granted capability this host silently drops is the confusion the grant
    // table exists to end.
    expect(missing).toEqual([]);
  });

  it("withholds the delegate and destructive tiers from an unattended container", () => {
    const unattended = new Set(agentToolManifest(false).map((tool) => tool.name));
    const withheld = AGENT_GRANTS.filter(
      (row) => row.tier === "delegate" || row.tier === "destructive-confirmed",
    );
    expect(withheld.length).toBeGreaterThan(0);
    for (const row of withheld) expect(unattended.has(row.agentName)).toBe(false);
    // The read tiers are unchanged: an unattended run still needs the vault.
    expect(unattended.has("search_vault")).toBe(true);
  });

  it("refuses those tiers at the executor too, not only in the menu", async () => {
    const result = await withTools(
      "tools-unattended",
      always,
      ({ call }) => call("delete_note", { path: "anything.md" }),
      false,
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Nobody is watching");
  });

  it("answers an unknown tool with a sentence, not a throw", async () => {
    const result = await withTools("tools-absent", always, ({ call }) =>
      call("summon_a_pony", { colour: "pink" }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no tool called summon_a_pony");
  });

  it("returns listings as a JSON array, never prose rows", async () => {
    const result = await withTools("tools-listing", always, async ({ host, call }) => {
      await host.vault.writeText("notes/alpha.md", "# Alpha\n");
      return call("list_vault", {});
    });
    const parsed: unknown = JSON.parse(result.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(result.text).toContain("notes/alpha.md");
  });

  it("refuses a stale checkbox rather than ticking the wrong one", async () => {
    const result = await withTools("tools-toggle-stale", always, async ({ host, call }) => {
      await host.vault.writeText("tasks.md", "- [ ] one\n- [ ] two\n");
      return call("toggle_task", { path: "tasks.md", ordinal: 0, expectedRaw: "- [ ] three" });
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("list_tasks");
  });

  it("toggles a checkbox the caller quoted exactly", async () => {
    const after = await withTools("tools-toggle", always, async ({ host, call }) => {
      await host.vault.writeText("tasks.md", "- [ ] one\n");
      const result = await call("toggle_task", {
        path: "tasks.md",
        ordinal: 0,
        expectedRaw: "- [ ] one",
      });
      expect(result.isError).toBe(false);
      return host.vault.readText("tasks.md");
    });
    expect(after).toBe("- [x] one\n");
  });

  it("asks before deleting, and a decline changes nothing", async () => {
    const asked: string[] = [];
    const survived = await withTools(
      "tools-delete-declined",
      (proposal) => {
        asked.push(proposal.title);
        return Promise.resolve(false);
      },
      async ({ host, call }) => {
        await host.vault.writeText("doomed.md", "keep me\n");
        const result = await call("delete_note", { path: "doomed.md" });
        expect(result.isError).toBe(true);
        return host.vault.lookup("doomed.md")?.state;
      },
    );
    expect(asked).toEqual(["Delete doomed.md?"]);
    expect(survived).toBe("live");
  });

  it("trashes a note the user confirmed", async () => {
    const state = await withTools("tools-delete", always, async ({ host, call }) => {
      await host.vault.writeText("doomed.md", "bye\n");
      const result = await call("delete_note", { path: "doomed.md" });
      expect(result.isError).toBe(false);
      return host.vault.lookup("doomed.md")?.state;
    });
    // A tombstone, not a removal: the trash is what "delete" means here.
    expect(state).toBe("trashed");
  });

  it("undoes its own edit back to the exact bytes it captured", async () => {
    const restored = await withTools("tools-undo", always, async ({ host, call }) => {
      await host.vault.writeText("note.md", "- [ ] before\n");
      await call("toggle_task", { path: "note.md", ordinal: 0, expectedRaw: "- [ ] before" });
      const undone = await call("undo_my_edits", { path: "note.md" });
      expect(undone.isError).toBe(false);
      return host.vault.readText("note.md");
    });
    expect(restored).toBe("- [ ] before\n");
  });

  it("refuses to undo a note it never edited in this conversation", async () => {
    const result = await withTools("tools-undo-foreign", always, async ({ host, call }) => {
      await host.vault.writeText("theirs.md", "the user's own words\n");
      return call("undo_my_edits", { path: "theirs.md" });
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not edited");
  });

  it("rewrites links when it renames a note", async () => {
    const body = await withTools("tools-rename", always, async ({ host, call }) => {
      await host.vault.writeText("old.md", "# Old\n");
      await host.vault.writeText("hub.md", "see [[Old]]\n");
      const result = await call("rename_note", { from: "old.md", to: "new.md" });
      expect(result.isError).toBe(false);
      return host.vault.readText("hub.md");
    });
    // The rewrite follows the FILE name, which is the thing that moved — the
    // link text takes the new stem's own spelling.
    expect(body).toBe("see [[new]]\n");
  });

  it("names the argument that did not fit rather than failing opaquely", async () => {
    const result = await withTools("tools-bad-args", always, ({ call }) =>
      call("read_note", { path: 7 }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("bad arguments");
  });
});
