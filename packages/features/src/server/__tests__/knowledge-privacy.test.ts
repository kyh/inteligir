// ---------------------------------------------------------------------------
// Outbound-payload guarantee for the agent knowledge tools (reflect's
// stream-chat payload-assertion pattern, adapted to the tool level): run the
// REAL search_vault / get_backlinks execute() closures over the REAL
// privacy-filtered port and a real core index, stringify every result the
// model would receive, and assert the private note's path, title, and body
// text never appear — including via backlinks-from-a-private-source and the
// index-lag TOCTOU case (public in the index, private on disk NOW).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "@repo/domain/knowledge/knowledge-index";
import { notePrivacy } from "@repo/domain/markdown/frontmatter";

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
  knowledgeExtension.register({ binDir: "/fake/bin", ports })(pi);
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

  it("get_backlinks on a private target answers 'No backlinks.' — a silent drop", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "get_backlinks", { path: PRIVATE_PATH });
    // Structured refusal would confirm the path's existence/privacy; the
    // silent sentinel is indistinguishable from a note with no backlinks.
    expect(payload).toContain("No backlinks.");
    expectNoLeak(payload);
  });

  it("get_backlinks drops backlinks whose SOURCE is private", async () => {
    const tools = captureTools(buildPort());
    const payload = await outbound(tools, "get_backlinks", { path: "open-notes.md" });
    expectNoLeak(payload); // secret-plans.md links to open-notes — must not show
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
});
