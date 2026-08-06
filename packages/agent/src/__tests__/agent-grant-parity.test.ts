// ---------------------------------------------------------------------------
// Grant-table parity guard — the fitness test the grant table's whole claim
// rests on: what the user can reach by CLICKING and what the model can reach
// by ASKING are the same surface, deliberately partitioned.
//
// Two halves, both DERIVED (walk the registry, walk the bundles) rather than
// maintained, in the family of no-dead-channels.test.ts:
//
//  (1) CLICKING ⇒ WEIGHED. Every non-event registry method appears exactly
//      once across AGENT_GRANTS ∪ AGENT_NEVER_GRANTED. A channel added later
//      is neither granted nor declared denied until someone writes the row —
//      which is the moment the question "may the agent do this?" gets asked.
//      Events are excluded by construction: a tool is a request/response with
//      no subscriber to be, so the table has nothing to say about a host → UI
//      push. That exclusion is asserted, not assumed.
//
//  (2) ASKING ⇔ GRANTED. The tools a grant-governed bundle actually registers
//      are exactly the table's granted rows. A tool with no row is a
//      capability nobody weighed; a row with no tool is a policy about
//      nothing. `grantedDescription` throws for the first case only when the
//      new tool remembers to call it, which is precisely what a tool sneaking
//      in would not do.
//
// "Grant-governed" is derived from the bundle's own source: a bundle that is
// handed one of the PROJECTED ports (knowledge / vault / actions) is acting on
// the user's notes through the privacy projection, and everything it exposes
// is a granted capability. pi's own machine-access tools (bash, execute,
// peekaboo, the connectors daemon) are not vault capabilities and carry no
// row — they reach no projected port, so they are outside this partition by
// the same derivation rather than by a list someone keeps.
//
// Conservative like its siblings: the source scan matches bare identifiers, so
// a bundle that reached a projected port through some indirection nobody has
// written yet would read as ungoverned. It errs toward passing — a failure
// here is always real.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_GRANTS,
  AGENT_NEVER_GRANTED,
  KNOWLEDGE_ONLY_CAPABILITIES,
} from "@repo/bridge/agent-grants";
import { IPC, IPC_METHODS, type IpcMethod } from "@repo/bridge/ipc-registry";

import { EXTENSION_BUNDLES } from "../bundles";
import type { AgentPorts, PiExtensionBundle } from "../extension";
import type { ExtensionAPI } from "@repo/agent/pi/pi-types";

const AGENT_SRC = path.resolve(import.meta.dirname, "..");

/** The ports that carry a privacy projection. A bundle handed one of these is
 * acting on the user's vault, so everything it registers is a capability the
 * table must declare. `executor`, `privacy` and `checkpoints` are host seams,
 * not vault capabilities. */
const PROJECTED_PORTS = ["knowledge", "vault", "actions"] as const;

/** Every .ts file under one bundle's folder, concatenated (bundle name IS the
 * folder name — bundles.test.ts pins that). */
function bundleSource(name: string): string {
  const dir = path.join(AGENT_SRC, name);
  if (!fs.existsSync(dir)) return "";
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".ts"))
    .map((entry) => fs.readFileSync(path.join(dir, entry), "utf8"))
    .join("\n");
}

/** Does this bundle receive a projected port — as `ports.vault`, or bound out
 * of `ports` by destructuring? */
function isGrantGoverned(source: string): boolean {
  if (new RegExp(`\\bports\\.(${PROJECTED_PORTS.join("|")})\\b`).test(source)) return true;
  return (source.match(/\{([^{}]*)\}\s*=\s*ports\b/g) ?? []).some((binding) =>
    PROJECTED_PORTS.some((port) => new RegExp(`\\b${port}\\b`).test(binding)),
  );
}

const unused = (): never => {
  throw new Error("port not called during registration");
};

/** Inert ports. Registration only closes over them; nothing here is invoked. */
function fakePorts(actions: AgentPorts["actions"]): AgentPorts {
  return {
    executor: {
      cli: { name: "executor", version: "0.0.0", binPath: "/fake/bin/executor" },
      install: async () => {},
      start: async () => false,
      execute: unused,
      resume: unused,
    },
    knowledge: {
      search: () => [],
      backlinks: () => [],
      forwardLinks: () => [],
      relatedNotes: () => [],
      notesWithTag: () => [],
      rename: () => ({ ok: false, reason: "not wired in this test" }),
    },
    vault: {
      listVault: () => [],
      readVaultDoc: () => null,
      getVaultFileFacts: () => null,
      listVaultTasks: () => [],
      listTags: () => ({ ok: true, tags: [] }),
      listWikiTargets: () => [],
      getLinkGraph: () => ({
        ok: true,
        graph: { totalNotes: 0, totalLinks: 0, orphans: [], hubs: [], clusters: [] },
      }),
      listDelegations: () => [],
    },
    actions,
    privacy: {
      probe: () => "indeterminate",
      vaultRealRoot: () => null,
      vaultLexicalRoot: () => null,
      privateIndexPaths: () => [],
    },
    checkpoints: null,
  };
}

const liveActions: NonNullable<AgentPorts["actions"]> = {
  toggleTask: () => ({ ok: false, reason: "not wired in this test" }),
  delegateTask: () => ({ ok: false, reason: "not wired in this test" }),
  cancelDelegation: () => ({ ok: false, reason: "not wired in this test" }),
  restoreDelegation: async () => ({ ok: false, reason: "not wired in this test" }),
  deleteNote: async () => ({ ok: false, reason: "not wired in this test" }),
  undoMyEdit: async () => ({ ok: false, reason: "not wired in this test" }),
};

/** Register bundles against a recording pi and collect the tool names. Every
 * other pi API is a no-op, so a bundle that also subscribes to a hook (the
 * privacy gate) registers without a real harness. */
async function registeredTools(
  bundles: PiExtensionBundle[],
  actions: AgentPorts["actions"],
): Promise<string[]> {
  const names: string[] = [];
  const pi = new Proxy(
    {
      registerTool: (tool: { name: string }) => {
        names.push(tool.name);
      },
    },
    { get: (target, prop) => Reflect.get(target, prop) ?? (() => {}) },
  ) as unknown as ExtensionAPI;
  for (const bundle of bundles) {
    await bundle.register({ binDir: "/fake/bin", ports: fakePorts(actions) })(pi);
  }
  return names.toSorted();
}

const GOVERNED_BUNDLES = EXTENSION_BUNDLES.filter((bundle) =>
  isGrantGoverned(bundleSource(bundle.name)),
);

describe("agent grant table ↔ bridge registry", () => {
  it("declares every non-event method exactly once, and no event at all", () => {
    const granted = AGENT_GRANTS.map((grant) => grant.capability).filter(
      (capability): capability is IpcMethod =>
        !(KNOWLEDGE_ONLY_CAPABILITIES as readonly string[]).includes(capability),
    );
    const declared = [...granted, ...AGENT_NEVER_GRANTED.flatMap((group) => group.capabilities)];

    const twice = declared.filter((method, i) => declared.indexOf(method) !== i);
    expect(twice, "a capability is both granted and never-granted, or listed twice").toEqual([]);

    const declaredSet = new Set<string>(declared);
    const unweighed = IPC_METHODS.filter(
      (method) => IPC[method].kind !== "event" && !declaredSet.has(method),
    );
    expect(
      unweighed,
      "bridge methods the agent grant table neither grants nor declares never-granted —\n" +
        "add a row to AGENT_GRANTS (implemented over an AgentPort, never the handler) or\n" +
        "to the AGENT_NEVER_GRANTED group whose reason fits:\n" +
        unweighed.map((method) => `  ${method}`).join("\n"),
    ).toEqual([]);

    expect(
      declared.filter((method) => IPC[method].kind === "event"),
      "events are host → UI pushes; a tool has no subscriber to be, so the table declares none",
    ).toEqual([]);
  });

  it("keeps the no-bridge-twin escape hatch for capabilities that truly have none", () => {
    const shadowed = KNOWLEDGE_ONLY_CAPABILITIES.filter((capability) =>
      (IPC_METHODS as string[]).includes(capability),
    );
    expect(
      shadowed,
      "these DO have a bridge method — name the method so the row stays traceable",
    ).toEqual([]);
  });
});

describe("agent grant table ↔ registered tools", () => {
  it("finds the grant-governed bundles by the ports they are handed", () => {
    // Not an assertion about WHICH bundles — that would be the maintained list
    // this test exists to avoid. It fails only when the derivation finds
    // nothing, which would make every check below vacuously pass.
    expect(GOVERNED_BUNDLES.length).toBeGreaterThan(0);
  });

  it("grants exactly the tools the grant-governed bundles register", async () => {
    const tools = await registeredTools(GOVERNED_BUNDLES, liveActions);
    const granted = AGENT_GRANTS.map((grant) => grant.agentName).toSorted();

    const undeclared = tools.filter((name) => !granted.includes(name));
    expect(
      undeclared,
      "tools the model can call that no grant row declares — reachable by asking, never\n" +
        "weighed. Add a row to AGENT_GRANTS:\n" +
        undeclared.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);

    const unregistered = granted.filter((name) => !tools.includes(name));
    expect(
      unregistered,
      "grant rows for tools nothing registers — a policy about nothing. Delete the row or\n" +
        "wire the tool up:\n" +
        unregistered.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);
  });

  it("withholds the delegate and destructive tiers from an unattended session", async () => {
    // AgentPorts.actions is null on the background delegation/routine session:
    // a destructive proposal has no conversation to be confirmed in, and an
    // agent that can delegate queues its own successors. Derived from the
    // `tier` field, so a row moved between tiers moves this expectation with
    // it. write-checkpointed is deliberately not asserted — rename_note rides
    // the knowledge port and stays available to a background run.
    const unattended = await registeredTools(GOVERNED_BUNDLES, null);
    const withheld = AGENT_GRANTS.filter(
      (grant) => grant.tier === "delegate" || grant.tier === "destructive-confirmed",
    ).map((grant) => grant.agentName);

    const leaked = withheld.filter((name) => unattended.includes(name));
    expect(
      leaked,
      "these register on a session with no human in it — gate them on `actions`:\n" +
        leaked.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);
  });
});
