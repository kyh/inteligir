// ---------------------------------------------------------------------------
// Outbound-payload guarantee for the agent-facing projections — asserted on the
// bytes the model would actually receive, not on the port's return values.
//
// Both bundles' REAL execute() closures run here, registered against one fake
// pi over the REAL privacy-filtered ports and a real core index — the knowledge
// tools (search_vault / get_backlinks / get_links / related_notes) and the vault
// tools (the nine whole-vault and host-state reads). The vault PROJECTIONS are
// additionally asserted directly, where the claim is about a shape the tool
// layer only forwards. Every one asserts the same thing: the private note's
// path, title, tasks and body text never appear — including via
// backlinks-from-a-private-source, links-TO-a-private-target, a conflict copy
// that spells a private note's name, and the index-lag TOCTOU case (public in
// the index, private on disk NOW).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";

import knowledgeExtension from "@repo/agent/knowledge-tools/extension";
import vaultTools from "@repo/agent/vault-tools/extension";
import { buildAgentKnowledgePort, buildAgentVaultPort } from "../boot/agent-knowledge-port";
import type { VaultReads } from "../boot/agent-knowledge-port";
import type {
  AgentLinkGraph,
  AgentLinkGraphResult,
  AgentPorts,
  AgentTagsResult,
  AgentVaultPort,
  KnowledgePort,
  PrivacyProbe,
} from "@repo/agent/extension";
import type { TagCount } from "@repo/notes/knowledge/tag-index";
import type { VaultEntry } from "@repo/bridge/ipc-registry";
import type { ExtensionAPI } from "@repo/agent/pi/pi-types";
import type { SyncSummary } from "../boot/agent-knowledge-port";
import type { Delegation } from "@repo/bridge/delegation";
import type { SyncStatus } from "@repo/notes/sync/status";

// Distinctive markers that exist ONLY in the private note — any of these in a
// tool result is a leak.
const PRIVATE_PATH = "secret-plans.md";
const PRIVATE_TITLE = "Umbrella Codename";
const PRIVATE_BODY = "TOP-SECRET umbrella rocket equations";
// A second private note, in a folder, carrying its own markers — the one the
// folder-scoped listing must not surface.
const PRIVATE_JOURNAL = "journal/2026-08-03.md";
// A conflict copy of the private note: sync named it after the note it forked
// from, and its own bytes are perfectly public. The copy is a real file on
// disk, so nothing but the NAME gives it away. It is deliberately a search hit,
// a tag carrier and a backlink source, so every projection has to drop it on
// its own.
const PRIVATE_CONFLICT_COPY = "secret-plans (conflict 2026-08-01T00-00-00-000Z).md";
// A conflict copy OF that copy. Inverting its name ONCE lands on a file that
// reads public, so a single-step origin check emits it — and its name spells
// the private stem anyway.
const DOUBLE_CONFLICT_COPY =
  "secret-plans (conflict 2026-08-01T00-00-00-000Z) (conflict 2026-08-02T00-00-00-000Z).md";
// A copy whose origin is ABSENT — the private note it forked from was renamed,
// moved or trashed. Fail-closed: the surviving copy must not un-hide the name.
const ORPHANED_CONFLICT_COPY = "moved-away (conflict 2026-08-01T00-00-00-000Z).md";

// The vault as bytes — the index is fed from it AND the live probe reads it,
// so index and disk agree except where a test overrides the disk.
const VAULT: Record<string, string> = {
  [PRIVATE_PATH]: `---\nprivate: true\ntags: [meta]\n---\n# ${PRIVATE_TITLE}\n\n${PRIVATE_BODY}\n\n- [ ] fuel the rocket\n\n[[open-notes]]\n`,
  "open-notes.md": "# Open notes\n\npublic umbrella research #meta\n\n[[secret-plans]]\n",
  "other.md": "# Other\n\numbrella stand shopping list\n",
  // Private and RELATED to open-notes without any direct link (shared #meta
  // tag + a lexical hit) — the related_notes candidate that must never show.
  // `classified` is a frontmatter tag NO public note carries: the tag list must
  // lose the name entirely, not merely report it with a smaller count.
  "hidden-lab.md":
    "---\nprivate: true\ntags: [meta, classified]\n---\n# Hidden Lab\n\nclassified centrifuge notes\n\n- [ ] spin the centrifuge\n",
  [PRIVATE_JOURNAL]: "---\nprivate: true\n---\n# Stakeout\n\nthe rendezvous is at dawn\n",
  [PRIVATE_CONFLICT_COPY]:
    "# Remote copy\n\nnothing sensitive in these bytes, umbrella included #logistics\n\n[[open-notes]]\n",
  [DOUBLE_CONFLICT_COPY]: "# Second fork\n\nalso nothing sensitive\n",
  [ORPHANED_CONFLICT_COPY]: "# Moved away\n\nthe note this forked from is gone\n",
  // The same shape over a PUBLIC note — the conflict-name rule must drop only
  // the copies whose origin is private, never every conflict copy.
  "other (conflict 2026-08-01T00-00-00-000Z).md": "# Other (remote)\n\nthe losing side\n",
  // Public task + tag carrier, deliberately lexically distinct from the notes
  // above so it perturbs neither the search nor the related_notes fixtures. Its
  // self-link is the graph's self-edge case.
  "chores.md":
    "# Chores\n\n#logistics\n\n- [ ] fold the laundry\n- [x] water the plants\n\nSee [[chores]].\n",
  "journal/2026-08-01.md": "# Groceries\n\nbuy oat milk\n",
  "journal/2026-08-02.md": "# Errands\n\nreturn the drill\n",
  // Public tagmate so related_notes(open-notes) has a legitimate survivor.
  "meta-index.md": "# Meta index\n\n#meta\n",
  // The get_links subject, carrying all three outcomes at once: a resolved
  // PUBLIC target, a resolved PRIVATE target (must vanish), and a dangling
  // link (no file behind it, so nothing to hide — must survive as
  // unresolved). Deliberately tag-free and lexically distinct from the notes
  // above so it doesn't perturb the search / related_notes fixtures, and it
  // links to hidden-lab rather than secret-plans so it shares no link target
  // with open-notes (co-citation would drag it into related_notes results).
  "link-hub.md": "# Link hub\n\nSee [[meta-index]], [[hidden-lab]] and [[nowhere]].\n",
};

// Non-doc vault files. They carry no frontmatter, so nothing can mark one
// private — the projections pass them through unprobed, and these pin that.
const ASSETS = ["assets/diagram.png"];

function seededIndex(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(VAULT)) index.setDoc(path, content);
  for (const path of ASSETS) index.setOther(path);
  return index;
}

/** The live-disk probe: reads the same corpus, with optional overrides for
 * the TOCTOU cases (disk moved after the index was built). */
function diskProbe(overrides: Record<string, string> = {}): (rel: string) => PrivacyProbe {
  return (rel) => {
    const content = overrides[rel] ?? VAULT[rel];
    if (content === undefined) return "absent";
    return notePrivacy(content);
  };
}

function buildPort(overrides: Record<string, string> = {}): KnowledgePort {
  const index = seededIndex();
  return buildAgentKnowledgePort({
    queries: () => index,
    probe: diskProbe(overrides),
    // These tests are fs-free; rename (which writes through the real
    // VaultManager) is covered by knowledge-rename-port.test.ts.
    vault: () => {
      throw new Error("rename is not under test in knowledge-privacy tests");
    },
    afterRename: () => {
      throw new Error("rename is not under test in knowledge-privacy tests");
    },
  });
}

// Capture the extension's registered tools so their execute() closures run
// for real (same stub pattern as knowledge-extension.test.ts).
type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
};

const unusedPort = (): never => {
  throw new Error("port not exercised by the privacy suite");
};

/** The ports both bundles are handed: the REAL privacy-filtered knowledge and
 * vault projections over the same corpus and the same disk overrides. `actions`
 * is null — the mutating tiers write, and what this file asserts is what comes
 * BACK. */
function privacyPorts(overrides: Record<string, string>): AgentPorts {
  return {
    executor: {
      cli: { name: "executor", version: "0.0.0", binPath: "/fake/bin/executor" },
      install: async () => {},
      start: async () => false,
      execute: unusedPort,
      resume: unusedPort,
    },
    knowledge: buildPort(overrides),
    vault: buildVaultPort({ overrides }),
    actions: null,
    privacy: {
      probe: diskProbe(overrides),
      vaultRealRoot: () => null,
      vaultLexicalRoot: () => null,
      privateIndexPaths: () => [],
    },
    checkpoints: null,
  };
}

/** Both grant-governed bundles on ONE fake pi, so every tool the model can call
 * is exercised by the assertions below rather than a chosen subset. */
function captureTools(overrides: Record<string, string> = {}): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const ports = privacyPorts(overrides);
  void knowledgeExtension.register({ binDir: "/fake/bin", ports })(pi);
  void vaultTools.register({ binDir: "/fake/bin", ports })(pi);
  return tools;
}

async function outbound(
  tools: Map<string, RegisteredTool>,
  name: string,
  params: unknown,
): Promise<string> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return JSON.stringify(await tool.execute("id", params));
}

function expectNoLeak(payload: string): void {
  expect(payload).not.toContain(PRIVATE_PATH);
  expect(payload).not.toContain(PRIVATE_TITLE);
  expect(payload).not.toContain("TOP-SECRET");
  expect(payload).not.toContain("rocket");
  expect(payload).not.toContain("hidden-lab");
  expect(payload).not.toContain("Hidden Lab");
  expect(payload).not.toContain("centrifuge");
  expect(payload).not.toContain(PRIVATE_JOURNAL);
  expect(payload).not.toContain("Stakeout");
  expect(payload).not.toContain("rendezvous");
  // The conflict copy's own bytes are public; its NAME is the leak, and
  // "secret-plans" is a prefix of both it and PRIVATE_PATH.
  expect(payload).not.toContain("secret-plans");
}

describe("agent knowledge tools — private notes never reach the model", () => {
  it("search_vault drops the private hit entirely; public hits survive", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expectNoLeak(payload);
    expect(payload).toContain("open-notes.md");
    expect(payload).toContain("other.md");
  });

  it("search_vault by tag drops the private tagged note", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "search_vault", { tag: "meta" });
    expectNoLeak(payload);
    expect(payload).toContain("open-notes.md");
  });

  it("get_backlinks on a private target answers with an empty array — a silent drop", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "get_backlinks", { path: PRIVATE_PATH });
    // Structured refusal would confirm the path's existence/privacy; an empty
    // result is indistinguishable from a note with no backlinks. The payload
    // shape changed from the "No backlinks." sentinel to a JSON array when the
    // read tools moved to delimiter-safe encoding — the CONTRACT (silent drop,
    // no oracle) is what this test pins, not the wording.
    expect(payload).toContain('"text":"[]"');
    expectNoLeak(payload);
  });

  it("get_backlinks drops backlinks whose SOURCE is private", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "get_backlinks", { path: "open-notes.md" });
    expectNoLeak(payload); // secret-plans.md links to open-notes — must not show
  });

  it("get_links drops a PRIVATE target; the public one and the dangling one survive", async () => {
    // Non-vacuity pin: the UNFILTERED index really does resolve link-hub's
    // middle link onto the private file. Without this, a fixture typo (a
    // wiki-link that quietly stops resolving) would turn the leak assertions
    // below into a test of nothing.
    const unfiltered = seededIndex().forwardLinks("link-hub.md");
    expect(unfiltered.map((entry) => entry.targetPath)).toEqual([
      "meta-index.md",
      "hidden-lab.md",
      null,
    ]);
    const tools = captureTools();
    const payload = await outbound(tools, "get_links", { path: "link-hub.md" });
    // What the tool adds over reading the note is RESOLUTION — the raw
    // `[[hidden-lab]]` text is in the body either way, but confirming it
    // lands on a real private file is the leak. So the row is dropped whole.
    expectNoLeak(payload);
    expect(payload).toContain("meta-index.md");
    // A dangling link has no file behind it and so cannot be private: it must
    // still be reported, explicitly unresolved rather than silently missing.
    expect(payload).toContain("nowhere");
    expect(payload).toContain("unresolved");
  });

  it("get_links on a private subject answers with an empty array — a silent drop", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "get_links", { path: PRIVATE_PATH });
    // Same no-oracle rule as get_backlinks: indistinguishable from a note
    // that links nowhere. secret-plans.md does link to open-notes, so this
    // empty result is the port's doing, not the fixture's.
    expect(payload).toContain('"text":"[]"');
    expectNoLeak(payload);
  });

  it("get_links TOCTOU: a target public in the index but private on disk NOW drops", async () => {
    const tools = captureTools({
      "meta-index.md": "---\nprivate: true\n---\n# Meta index\n\n#meta\n",
    });
    const payload = await outbound(tools, "get_links", { path: "link-hub.md" });
    expect(payload).not.toContain("meta-index.md");
    expect(payload).toContain("nowhere"); // the rest of the note's links stay
    expectNoLeak(payload);
  });

  it("TOCTOU: a note public in the index but private on disk NOW is dropped", async () => {
    // The index still holds other.md as public (it was at build time); the
    // live probe sees the just-saved `private: true`. The re-probe wins.
    const tools = captureTools({
      "other.md": "---\nprivate: true\n---\n# Other\n\numbrella stand\n",
    });
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expect(payload).not.toContain("other.md");
    expect(payload).toContain("open-notes.md");
    expectNoLeak(payload);
  });

  it("fail-closed: a hit whose disk copy turned unreadable (indeterminate) is dropped", async () => {
    const tools = captureTools({ "other.md": "---\n[not: valid: yaml\n---\numbrella stand\n" });
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expect(payload).not.toContain("other.md");
  });

  it("related_notes drops a private candidate (related via tag + text, no direct link)", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "related_notes", { path: "open-notes.md" });
    expectNoLeak(payload); // hidden-lab shares #meta and text — must not show
    expect(payload).toContain("meta-index.md"); // the public tagmate survives
  });

  it("related_notes on a private subject answers with an empty array — a silent drop", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "related_notes", { path: PRIVATE_PATH });
    expect(payload).toContain('"text":"[]"');
    expectNoLeak(payload);
  });

  it("search_vault by tag drops a conflict copy whose origin is private", async () => {
    // The copy's own bytes are public and it really does carry #logistics, so
    // the index hands it over and only the origin check takes it out.
    expect(seededIndex().notesWithTag("logistics", { excludePrivate: true })).toContain(
      PRIVATE_CONFLICT_COPY,
    );
    const tools = captureTools();
    const payload = await outbound(tools, "search_vault", { tag: "logistics" });
    expectNoLeak(payload);
    expect(payload).toContain("chores.md");
  });

  it("related_notes TOCTOU: a candidate public in the index but private on disk NOW drops", async () => {
    const tools = captureTools({
      "meta-index.md": "---\nprivate: true\n---\n# Meta index\n\n#meta\n",
    });
    const payload = await outbound(tools, "related_notes", { path: "open-notes.md" });
    expect(payload).not.toContain("meta-index.md");
    expectNoLeak(payload);
  });
});

// ---------------------------------------------------------------------------
// The vault port — whole-vault listings and host state. No tools exist for
// these yet, so the projections themselves are stringified and held to the
// SAME expectNoLeak rule the tool payloads above are.
// ---------------------------------------------------------------------------

const SYNC_EMAIL = "vault-owner@example.com";
const COORDINATOR_URL = "https://vault-sync.example.workers.dev";
const PUBLIC_CONFLICT_COPY = "other (conflict 2026-08-01T00-00-00-000Z).md";

/** The sync source as the HOST really hands it over: the full Bridge state,
 * account fields and all. It is declared wide and then narrowed on assignment
 * to the port's `SyncSummary`, which is the point — the extra fields are
 * present at runtime for the projection to leak if it ever spread them, and
 * absent from the type so it cannot name them. (The account vocabulary itself
 * is fenced out of this file by account-boundary.test.ts, which is why the
 * signed-in flag never appears here or in the port.) */
function syncSourceWith(status: SyncStatus = { phase: "idle" }): SyncSummary {
  const hostState = {
    enabled: true,
    email: SYNC_EMAIL,
    coordinatorUrl: COORDINATOR_URL,
    status,
    conflicts: [{ path: PUBLIC_CONFLICT_COPY }, { path: PRIVATE_CONFLICT_COPY }],
  };
  return hostState;
}

/** A field the stored record does not carry today — standing in for whatever
 * the Bridge's `Delegation` grows next. Present at runtime, absent from the
 * type, exactly like syncSourceWith's account fields. */
const HOST_ONLY_DELEGATION_FIELD = "~/.inteligir/sessions/background.jsonl";

function delegationOn(sourceFile: string, lineText: string): Delegation {
  const record = {
    transcriptPath: HOST_ONLY_DELEGATION_FIELD,
    id: `delegation-${sourceFile}`,
    sourceFile,
    anchor: { ordinal: 0, text: lineText, heading: null },
    lineText,
    status: "done" as const,
    createdAt: 1,
    startedAt: 2,
    finishedAt: 3,
    resultSummary: "handled it",
    error: null,
    hasSnapshot: true,
    restoredAt: null,
  };
  return record;
}

const DELEGATIONS: Delegation[] = [
  delegationOn("chores.md", "- [ ] fold the laundry"),
  delegationOn(PRIVATE_PATH, "- [ ] fuel the rocket"),
];

/** The vault as the crawl + the file reads see it, sharing the disk overrides
 * with the probe so a TOCTOU case moves both together. */
function diskVault(overrides: Record<string, string> = {}): VaultReads {
  const files: Record<string, string> = { ...VAULT, ...overrides };
  return {
    list: () =>
      [...Object.keys(files), ...ASSETS].toSorted().map(
        (path): VaultEntry => ({
          path,
          name: path.slice(path.lastIndexOf("/") + 1),
          kind: ASSETS.includes(path) ? "other" : "doc",
        }),
      ),
    readText: (rel) => {
      const content = files[rel];
      if (content === undefined) throw new Error(`ENOENT: ${rel}`);
      return content;
    },
    fileFacts: (rel) => {
      const content = files[rel];
      return content === undefined ? null : { sizeBytes: content.length, modifiedMs: 1 };
    },
  };
}

/** Unwrap a sweep result, failing loudly on the refusal — these fixtures are a
 * dozen notes, so a refusal here means the corpus ceiling moved, not that the
 * assertion below is inapplicable. */
function expectTags(result: AgentTagsResult): TagCount[] {
  if (!result.ok) throw new Error(`listTags refused unexpectedly: ${result.reason}`);
  return result.tags;
}

function expectGraph(result: AgentLinkGraphResult): AgentLinkGraph {
  if (!result.ok) throw new Error(`getLinkGraph refused unexpectedly: ${result.reason}`);
  return result.graph;
}

function buildVaultPort(
  opts: {
    overrides?: Record<string, string>;
    sync?: SyncSummary;
    delegations?: Delegation[];
  } = {},
): AgentVaultPort {
  const index = seededIndex();
  const overrides = opts.overrides ?? {};
  return buildAgentVaultPort({
    queries: () => index,
    probe: diskProbe(overrides),
    vault: () => diskVault(overrides),
    sync: () => opts.sync ?? syncSourceWith(),
    delegations: () => opts.delegations ?? DELEGATIONS,
  });
}

describe("agent vault port — private notes never reach the model", () => {
  it("listVault drops private docs and passes attachments through", () => {
    // Non-vacuity: the crawl itself really does carry every private path, so
    // the assertions below are the port's doing, not the fixture's.
    expect(
      diskVault()
        .list()
        .map((entry) => entry.path),
    ).toContain(PRIVATE_PATH);
    const entries = buildVaultPort().listVault();
    const paths = entries.map((entry) => entry.path);
    expectNoLeak(JSON.stringify(entries));
    expect(paths).toContain("chores.md");
    // An attachment carries no frontmatter, so nothing can mark it private and
    // the port never probes it.
    expect(paths).toContain("assets/diagram.png");
    // A conflict copy of a PUBLIC note is an ordinary public file.
    expect(paths).toContain(PUBLIC_CONFLICT_COPY);
  });

  it("listVault walks the WHOLE conflict chain, and fails closed on a lost origin", () => {
    // Non-vacuity: both copies are real files whose own bytes read public, and
    // the intermediate one the double copy inverts to reads public too — one
    // step of origin checking clears it.
    expect(diskProbe()(DOUBLE_CONFLICT_COPY)).toBe("public");
    expect(diskProbe()(PRIVATE_CONFLICT_COPY)).toBe("public");
    expect(diskProbe()(ORPHANED_CONFLICT_COPY)).toBe("public");
    const paths = buildVaultPort()
      .listVault()
      .map((entry) => entry.path);
    expect(paths).not.toContain(DOUBLE_CONFLICT_COPY);
    // The origin is gone, so nothing confirms it was ever private — which is
    // exactly why this drops: renaming or trashing a private note must not
    // un-hide its name through the copy that outlived it.
    expect(paths).not.toContain(ORPHANED_CONFLICT_COPY);
  });

  it("listVault scopes to a folder, and the limit bounds the PROBE window", () => {
    // Three entries live under journal/, one of them private: the window of
    // three is what gets read, and the page comes back short — which is the
    // trade listVault states, not a claim of silence.
    const entries = buildVaultPort().listVault({ folder: "journal", limit: 3 });
    expect(entries.map((entry) => entry.path)).toEqual([
      "journal/2026-08-01.md",
      "journal/2026-08-02.md",
    ]);
    expectNoLeak(JSON.stringify(entries));
  });

  it("listVault honours a smaller limit", () => {
    expect(buildVaultPort().listVault({ limit: 1 })).toHaveLength(1);
  });

  it("readVaultDoc reads a private note as absent, and public bytes verbatim", () => {
    const port = buildVaultPort();
    expect(port.readVaultDoc(PRIVATE_PATH)).toBeNull();
    // Same null a missing file gives, so a refusal confirms nothing.
    expect(port.readVaultDoc("no-such-note.md")).toBeNull();
    expect(port.readVaultDoc("other.md")).toContain("umbrella stand");
  });

  it("readVaultDoc TOCTOU: privacy is decided on the bytes being returned", () => {
    const port = buildVaultPort({
      overrides: { "other.md": "---\nprivate: true\n---\n# Other\n\numbrella stand\n" },
    });
    expect(port.readVaultDoc("other.md")).toBeNull();
  });

  it("readVaultDoc reads docs only, and refuses one too large for a transcript", () => {
    const port = buildVaultPort({
      overrides: {
        // Readable bytes behind the attachment path, so the null below is the
        // doc gate and not a missing file.
        "assets/diagram.png": "PNG\r\n\n binary payload",
        "huge.md": `# Huge\n\n${"padding ".repeat(40_000)}`,
      },
    });
    expect(port.readVaultDoc("assets/diagram.png")).toBeNull();
    expect(port.readVaultDoc("huge.md")).toBeNull();
    expect(port.readVaultDoc("other.md")).toContain("umbrella stand");
  });

  it("getVaultFileFacts returns nothing for a private note", () => {
    const port = buildVaultPort();
    expect(port.getVaultFileFacts(PRIVATE_PATH)).toBeNull();
    expect(port.getVaultFileFacts("chores.md")).not.toBeNull();
  });

  it("listVaultTasks drops private rows — the verbatim source line included", () => {
    // Non-vacuity: unfiltered, the private note's task line IS in the result.
    expect(JSON.stringify(seededIndex().tasks())).toContain("fuel the rocket");
    const tasks = buildVaultPort().listVaultTasks();
    const payload = JSON.stringify(tasks);
    expectNoLeak(payload);
    expect(payload).toContain("fold the laundry");
    expect(payload).toContain("water the plants");
  });

  it("listVaultTasks and listWikiTargets bound the page they probe", () => {
    const port = buildVaultPort();
    // Tasks come sorted by path, so this page's head is a public row and the
    // page is exactly its limit.
    expect(port.listVaultTasks({ limit: 1 })).toHaveLength(1);
    // Both page rows the index has ALREADY filtered, so a page is short only
    // where the live probe drops something the index still believed public.
    expect(port.listWikiTargets({ limit: 2 })).toHaveLength(2);
    expect(port.listWikiTargets().length).toBeGreaterThan(2);
  });

  it("listTags recomputes counts and loses a private-only tag entirely", () => {
    // Unfiltered, #meta has four carriers, two of them private.
    expect(seededIndex().tags()).toContainEqual({ tag: "meta", count: 4 });
    const tags = expectTags(buildVaultPort().listTags());
    expectNoLeak(JSON.stringify(tags));
    // The tag NAME is the leak, so a tag no public note carries disappears
    // rather than surviving with a smaller number.
    expect(tags.map((entry) => entry.tag)).not.toContain("classified");
    expect(tags).toContainEqual({ tag: "meta", count: 2 });
    expect(tags).toContainEqual({ tag: "logistics", count: 1 });
  });

  it("listTags TOCTOU: a carrier public in the index but private on disk NOW is uncounted", () => {
    const tags = expectTags(
      buildVaultPort({
        overrides: { "meta-index.md": "---\nprivate: true\n---\n# Meta index\n\n#meta\n" },
      }).listTags(),
    );
    expect(tags).toContainEqual({ tag: "meta", count: 1 });
  });

  it("listWikiTargets drops private docs (path, title and aliases alike)", () => {
    const targets = buildVaultPort().listWikiTargets();
    const payload = JSON.stringify(targets);
    expectNoLeak(payload);
    expect(payload).toContain("meta-index.md");
    expect(payload).toContain("assets/diagram.png");
  });

  it("getLinkGraph answers derived, over the public graph only", () => {
    // Non-vacuity: the raw graph really does carry the private notes as nodes.
    expect(JSON.stringify(seededIndex().graph())).toContain(PRIVATE_PATH);
    const summary = expectGraph(buildVaultPort().getLinkGraph());
    expectNoLeak(JSON.stringify(summary));
    // open-notes, other, chores, journal/01, journal/02, meta-index, link-hub
    // and the public conflict copy — the three private notes and the conflict
    // copy that spells one of their names are all absent from the COUNT too.
    expect(summary.totalNotes).toBe(8);
    // link-hub → meta-index is the only edge left standing: its link to the
    // private note is gone, and its dangling one was never a note.
    expect(summary.totalLinks).toBe(1);
    expect(summary.clusters).toEqual([{ size: 2, members: ["link-hub.md", "meta-index.md"] }]);
    // open-notes' only link points at the private note, so in the graph the
    // model is handed it stands alone.
    expect(summary.orphans).toContain("open-notes.md");
    expect(summary.hubs.map((hub) => hub.path)).toEqual(["link-hub.md", "meta-index.md"]);
  });

  it("getLinkGraph counts a self-link nowhere", () => {
    // Non-vacuity: the raw graph really does carry the self-edge.
    expect(seededIndex().graph().edges).toContainEqual({
      source: "chores.md",
      target: "chores.md",
      kind: "wiki",
      count: 1,
    });
    const summary = expectGraph(buildVaultPort().getLinkGraph());
    // A note linked to itself is connected to nothing, so counting the edge in
    // the total but not in the degree would render it an orphan with a link.
    expect(summary.totalLinks).toBe(1);
    expect(summary.orphans).toContain("chores.md");
  });

  it("getSyncState strips the account email and the coordinator address", () => {
    const state = buildVaultPort().getSyncState();
    const payload = JSON.stringify(state);
    expect(payload).not.toContain(SYNC_EMAIL);
    expect(payload).not.toContain(COORDINATOR_URL);
    expect(state.enabled).toBe(true);
  });

  it("getSyncState drops a conflict copy that spells a private note's name", () => {
    const state = buildVaultPort().getSyncState();
    expectNoLeak(JSON.stringify(state));
    // The dropped copy's own bytes are public — only its NAME, taken from the
    // note it forked from, gives it away. The public note's copy survives, so
    // this is the origin check working and not a blanket refusal.
    expect(state.conflicts).toEqual([PUBLIC_CONFLICT_COPY]);
  });

  it("getSyncState filters the held-pass sample and drops the error message", () => {
    const held = buildVaultPort({
      sync: syncSourceWith({
        phase: "held",
        deletions: 3,
        baseCount: 40,
        sample: [PRIVATE_PATH, "chores.md"],
      }),
    }).getSyncState();
    expectNoLeak(JSON.stringify(held));
    expect(held.status).toEqual({
      phase: "held",
      deletions: 3,
      baseCount: 40,
      sample: ["chores.md"],
    });

    const failed = buildVaultPort({
      sync: syncSourceWith({
        phase: "error",
        message: `PUT ${COORDINATOR_URL}/v1/vault/${PRIVATE_PATH} failed`,
      }),
    }).getSyncState();
    // A host-generated message routinely embeds the coordinator URL and a vault
    // path; there is no sanitizing an arbitrary string, so only the phase goes.
    expect(failed.status).toEqual({ phase: "error" });
    expectNoLeak(JSON.stringify(failed));
  });

  it("getSyncState enumerates the ok phase rather than passing the status through", () => {
    // Declared wide, narrowed on assignment — the extra field is there at
    // runtime for a pass-through to carry, and absent from the type.
    const hostStatus = {
      phase: "ok" as const,
      pushed: 1,
      pulled: 2,
      deleted: 0,
      conflicts: 1,
      merged: 3,
      message: `PUT ${COORDINATOR_URL} retried`,
    };
    const status: SyncStatus = hostStatus;
    const state = buildVaultPort({ sync: syncSourceWith(status) }).getSyncState();
    expect(state.status).toEqual({
      phase: "ok",
      pushed: 1,
      pulled: 2,
      deleted: 0,
      conflicts: 1,
      merged: 3,
    });
    expect(JSON.stringify(state)).not.toContain(COORDINATOR_URL);
  });

  it("listDelegations drops the whole record for a note that turned private", () => {
    const records = buildVaultPort().listDelegations();
    const payload = JSON.stringify(records);
    // The record was created while the note was public and stores a raw line
    // of it; privacy is never re-checked on read, so the drop happens here.
    expectNoLeak(payload);
    expect(records.map((record) => record.sourceFile)).toEqual(["chores.md"]);
  });

  it("listDelegations rebuilds the record field by field", () => {
    const records = buildVaultPort().listDelegations();
    expect(records.map((record) => Object.keys(record).toSorted())).toEqual([
      [
        "createdAt",
        "error",
        "finishedAt",
        "id",
        "lineText",
        "resultSummary",
        "sourceFile",
        "startedAt",
        "status",
      ],
    ]);
    // The stored record's host-side bookkeeping stays host-side.
    expect(JSON.stringify(records)).not.toContain(HOST_ONLY_DELEGATION_FIELD);
  });
});

// ---------------------------------------------------------------------------
// The vault TOOLS — the same rule one layer up, on the bytes the model receives.
// The projections above are asserted directly because some of their claims are
// about shapes (a rebuilt record, an enumerated status); this block asserts that
// nothing between a projection and the tool result re-introduces what the
// projection dropped. Every read tool the bundle registers is driven, derived
// from the registration itself so a tenth one cannot be added un-asserted.
// ---------------------------------------------------------------------------

describe("agent vault tools — private notes never reach the model", () => {
  /** One safe call per read tool: the private note is named where a path is
   * required, so a tool that answers about it at all fails here. */
  const CALLS: Record<string, unknown> = {
    list_vault: {},
    read_note: { path: PRIVATE_PATH },
    get_note_facts: { path: PRIVATE_PATH },
    list_tasks: {},
    list_tags: {},
    list_wiki_targets: {},
    get_link_graph: {},
    get_sync_state: {},
    list_delegations: {},
  };

  it("covers every read tool the bundle registers", () => {
    // DERIVED from the registration, not filtered by CALLS: filtering the
    // registered set by the expected one makes an unlisted tool invisible,
    // which is the shape this assertion exists to catch. `privacyPorts` passes
    // `actions: null`, so vault-tools alone registers exactly the reads.
    const reads = new Map<string, RegisteredTool>();
    const pi = {
      registerTool: (tool: RegisteredTool) => reads.set(tool.name, tool),
    } as unknown as ExtensionAPI;
    void vaultTools.register({ binDir: "/fake/bin", ports: privacyPorts({}) })(pi);
    expect([...reads.keys()].toSorted()).toEqual(Object.keys(CALLS).toSorted());
  });

  // read_note is asserted separately and more strictly: its one refusal
  // sentence echoes the path the MODEL supplied, which expectNoLeak would read
  // as a leak. What matters there is that the sentence is the same one a
  // missing file produces.
  const SILENT_TOOLS = Object.keys(CALLS).filter((name) => name !== "read_note");

  it.each(SILENT_TOOLS)("%s leaks nothing about a private note", async (name) => {
    const tools = captureTools();
    expectNoLeak(await outbound(tools, name, CALLS[name]));
  });

  it("read_note answers a private note exactly as it answers a missing one", async () => {
    const tools = captureTools();
    const refused = await outbound(tools, "read_note", { path: PRIVATE_PATH });
    const missing = await outbound(tools, "read_note", { path: "no-such-note.md" });
    // Substituting the echoed path makes the two answers identical — a refusal
    // that confirms nothing — and leaves a payload the leak rule can judge.
    const withoutEcho = refused.replaceAll(PRIVATE_PATH, "no-such-note.md");
    expect(withoutEcho).toBe(missing);
    expectNoLeak(withoutEcho);
  });

  it("list_tasks narrows to a folder without surfacing the private note in it", async () => {
    const tools = captureTools();
    const payload = await outbound(tools, "list_tasks", { folder: "journal" });
    expectNoLeak(payload);
    expect(payload).not.toContain("fold the laundry");
  });

  it("TOCTOU: a note public in the index but private on disk NOW drops from the listing", async () => {
    const tools = captureTools({
      "other.md": "---\nprivate: true\n---\n# Other\n\numbrella stand\n",
    });
    const payload = await outbound(tools, "list_vault", {});
    expect(payload).not.toContain("other.md");
    expect(payload).toContain("chores.md");
    expectNoLeak(payload);
  });
});
