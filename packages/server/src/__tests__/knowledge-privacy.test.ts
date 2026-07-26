// ---------------------------------------------------------------------------
// Outbound-payload guarantee for the agent knowledge tools — asserted on the
// bytes the model would actually receive, not on the port's return values: run
// the REAL search_vault / get_backlinks / get_links / related_notes execute()
// closures over the REAL privacy-filtered port and a real core index,
// stringify every result the model would receive, and assert the private
// note's path, title, and body text never appear — including via
// backlinks-from-a-private-source, links-TO-a-private-target, and the
// index-lag TOCTOU case (public in the index, private on disk NOW).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { notePrivacy } from "@repo/notes/markdown/frontmatter";

import knowledgeExtension from "@repo/agent/knowledge-tools/extension";
import { buildAgentKnowledgePort } from "../boot/agent-knowledge-port";
import type { AgentPorts, KnowledgePort, PrivacyProbe } from "@repo/agent/extension";
import type { ExtensionAPI } from "@repo/agent/pi/pi-types";

// Distinctive markers that exist ONLY in the private note — any of these in a
// tool result is a leak.
const PRIVATE_PATH = "secret-plans.md";
const PRIVATE_TITLE = "Umbrella Codename";
const PRIVATE_BODY = "TOP-SECRET umbrella rocket equations";

// The vault as bytes — the index is fed from it AND the live probe reads it,
// so index and disk agree except where a test overrides the disk.
const VAULT: Record<string, string> = {
  [PRIVATE_PATH]: `---\nprivate: true\ntags: [meta]\n---\n# ${PRIVATE_TITLE}\n\n${PRIVATE_BODY}\n\n[[open-notes]]\n`,
  "open-notes.md": "# Open notes\n\npublic umbrella research #meta\n\n[[secret-plans]]\n",
  "other.md": "# Other\n\numbrella stand shopping list\n",
  // Private and RELATED to open-notes without any direct link (shared #meta
  // tag + a lexical hit) — the related_notes candidate that must never show.
  "hidden-lab.md":
    "---\nprivate: true\ntags: [meta]\n---\n# Hidden Lab\n\nclassified centrifuge notes\n",
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

function seededIndex(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(VAULT)) index.setDoc(path, content);
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

function captureTools(port: KnowledgePort): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  const ports = { knowledge: port } as unknown as AgentPorts;
  void knowledgeExtension.register({ binDir: "/fake/bin", ports })(pi);
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
}

describe("agent knowledge tools — private notes never reach the model", () => {
  it("search_vault drops the private hit entirely; public hits survive", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expectNoLeak(payload);
    expect(payload).toContain("open-notes.md");
    expect(payload).toContain("other.md");
  });

  it("search_vault by tag drops the private tagged note", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "search_vault", { tag: "meta" });
    expectNoLeak(payload);
    expect(payload).toContain("open-notes.md");
  });

  it("get_backlinks on a private target answers with an empty array — a silent drop", async () => {
    const tools = captureTools(buildPort());
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
    const tools = captureTools(buildPort());
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
    const tools = captureTools(buildPort());
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
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "get_links", { path: PRIVATE_PATH });
    // Same no-oracle rule as get_backlinks: indistinguishable from a note
    // that links nowhere. secret-plans.md does link to open-notes, so this
    // empty result is the port's doing, not the fixture's.
    expect(payload).toContain('"text":"[]"');
    expectNoLeak(payload);
  });

  it("get_links TOCTOU: a target public in the index but private on disk NOW drops", async () => {
    const tools = captureTools(
      buildPort({ "meta-index.md": "---\nprivate: true\n---\n# Meta index\n\n#meta\n" }),
    );
    const payload = await outbound(tools, "get_links", { path: "link-hub.md" });
    expect(payload).not.toContain("meta-index.md");
    expect(payload).toContain("nowhere"); // the rest of the note's links stay
    expectNoLeak(payload);
  });

  it("TOCTOU: a note public in the index but private on disk NOW is dropped", async () => {
    // The index still holds other.md as public (it was at build time); the
    // live probe sees the just-saved `private: true`. The re-probe wins.
    const tools = captureTools(
      buildPort({ "other.md": "---\nprivate: true\n---\n# Other\n\numbrella stand\n" }),
    );
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expect(payload).not.toContain("other.md");
    expect(payload).toContain("open-notes.md");
    expectNoLeak(payload);
  });

  it("fail-closed: a hit whose disk copy turned unreadable (indeterminate) is dropped", async () => {
    const tools = captureTools(
      buildPort({ "other.md": "---\n[not: valid: yaml\n---\numbrella stand\n" }),
    );
    const payload = await outbound(tools, "search_vault", { query: "umbrella" });
    expect(payload).not.toContain("other.md");
  });

  it("related_notes drops a private candidate (related via tag + text, no direct link)", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "related_notes", { path: "open-notes.md" });
    expectNoLeak(payload); // hidden-lab shares #meta and text — must not show
    expect(payload).toContain("meta-index.md"); // the public tagmate survives
  });

  it("related_notes on a private subject answers with an empty array — a silent drop", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "related_notes", { path: PRIVATE_PATH });
    expect(payload).toContain('"text":"[]"');
    expectNoLeak(payload);
  });

  it("related_notes TOCTOU: a candidate public in the index but private on disk NOW drops", async () => {
    const tools = captureTools(
      buildPort({ "meta-index.md": "---\nprivate: true\n---\n# Meta index\n\n#meta\n" }),
    );
    const payload = await outbound(tools, "related_notes", { path: "open-notes.md" });
    expect(payload).not.toContain("meta-index.md");
    expectNoLeak(payload);
  });
});
