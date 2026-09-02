// the markers are line grammar, not block grammar (micromark reads them as paragraph text), so
// this is a root transform splitting marker lines out of top-level text leaves; a marker
// swallowed by an inline construct is not a marker. content before the first `=== Label` or a
// `:::tabs` that never closes aborts the rewrite rather than guessing.

import type { Node, PhrasingContent, Root } from "mdast";
import type { Options as ToMarkdownExtension } from "mdast-util-to-markdown";
import type { Plugin, Processor, Transformer } from "unified";

type RootChild = Root["children"][number];
type PanelContent = Exclude<RootChild, { type: "yaml" | "tabGroup" | "tabPanel" }>;

export interface TabPanel extends Node {
  type: "tabPanel";
  label: string;
  children: PanelContent[];
}

export interface TabGroup extends Node {
  type: "tabGroup";
  children: TabPanel[];
}

declare module "mdast" {
  interface RootContentMap {
    tabPanel: TabPanel;
    tabGroup: TabGroup;
  }
  interface BlockContentMap {
    tabGroup: TabGroup;
  }
}

const OPEN_LINE = ":::tabs";
const CLOSE_LINE = ":::";
const PANEL_RE = /^=== (.+)$/;

type Segment =
  | { kind: "open" }
  | { kind: "panel"; label: string }
  | { kind: "close" }
  | { kind: "content"; nodes: PhrasingContent[] };

function markerFor(line: string): Segment | null {
  if (line === OPEN_LINE) return { kind: "open" };
  if (line === CLOSE_LINE) return { kind: "close" };
  const panel = PANEL_RE.exec(line);
  const label = panel?.[1];
  if (label !== undefined) return { kind: "panel", label };
  return null;
}

function splitParagraph(children: PhrasingContent[]): Segment[] {
  const segments: Segment[] = [];
  let current: PhrasingContent[] = [];
  let atLineStart = true;

  const flush = (): void => {
    if (current.length > 0) {
      segments.push({ kind: "content", nodes: current });
      current = [];
    }
  };
  const pushText = (value: string): void => {
    if (value === "") return;
    const last = current.at(-1);
    if (last?.type === "text") last.value += value;
    else current.push({ type: "text", value });
  };

  for (const [index, child] of children.entries()) {
    if (child.type !== "text") {
      current.push(child);
      atLineStart = child.type === "break";
      continue;
    }
    const lines = child.value.split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      const startsLine = lineIndex > 0 || atLineStart;
      const endsAtNewline = lineIndex < lines.length - 1;
      const endsParagraph = lineIndex === lines.length - 1 && index === children.length - 1;
      const marker =
        startsLine && (endsAtNewline || endsParagraph) && line !== "" ? markerFor(line) : null;
      if (marker !== null) {
        flush();
        segments.push(marker);
      } else {
        // restore the newline the split consumed, only between kept lines.
        if (lineIndex > 0 && current.length > 0) pushText("\n");
        pushText(line);
      }
    }
    atLineStart = child.value.endsWith("\n");
  }
  flush();
  return segments;
}

function hasMarker(segments: Segment[]): boolean {
  return segments.some((segment) => segment.kind !== "content");
}

type PanelDraft = { label: string; children: PanelContent[] };

function asPanelContent(node: RootChild): PanelContent | null {
  if (node.type === "yaml" || node.type === "tabGroup" || node.type === "tabPanel") {
    return null;
  }
  return node;
}

type Collect = {
  panels: PanelDraft[];
  closed: boolean;
  aborted: boolean;
  trailing: PhrasingContent[] | null;
};

function acceptSegments(collect: Collect, segments: Segment[], from: number): void {
  for (let index = from; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === undefined) continue;
    if (collect.closed) {
      // a second marker after the close in the same paragraph is ambiguous: refuse whole.
      if (segment.kind !== "content") {
        collect.aborted = true;
        return;
      }
      collect.trailing = [...(collect.trailing ?? []), ...segment.nodes];
      continue;
    }
    switch (segment.kind) {
      case "open":
        collect.aborted = true; // nested opener — refuse the whole construct
        return;
      case "panel":
        collect.panels.push({ children: [], label: segment.label });
        break;
      case "close":
        collect.closed = true;
        break;
      case "content": {
        const panel = collect.panels.at(-1);
        if (panel === undefined) {
          collect.aborted = true; // content before the first `=== ` header
          return;
        }
        panel.children.push({ children: segment.nodes, type: "paragraph" });
        break;
      }
    }
  }
}

function rewriteRoot(root: Root): void {
  for (let start = 0; start < root.children.length; start++) {
    const opener = root.children[start];
    if (opener?.type !== "paragraph") continue;
    const openerSegments = splitParagraph(opener.children);
    if (openerSegments[0]?.kind !== "open") continue;

    const collect: Collect = { aborted: false, closed: false, panels: [], trailing: null };
    acceptSegments(collect, openerSegments, 1);

    let end = start;
    for (let index = start + 1; index < root.children.length; index++) {
      if (collect.closed || collect.aborted) break;
      const node = root.children[index];
      if (node === undefined) break;
      end = index;
      if (node.type === "paragraph") {
        const segments = splitParagraph(node.children);
        if (hasMarker(segments)) {
          acceptSegments(collect, segments, 0);
          continue;
        }
      }
      const content = asPanelContent(node);
      const panel = collect.panels.at(-1);
      if (content === null || panel === undefined) {
        collect.aborted = true;
        break;
      }
      panel.children.push(content);
    }

    if (collect.aborted || !collect.closed || collect.panels.length === 0) continue;

    const tabs: TabGroup = {
      children: collect.panels.map((panel): TabPanel => ({
        children: panel.children,
        label: panel.label,
        type: "tabPanel",
      })),
      type: "tabGroup",
    };
    const replacement: RootChild[] = [tabs];
    if (collect.trailing !== null && collect.trailing.length > 0) {
      replacement.push({ children: collect.trailing, type: "paragraph" });
    }
    root.children.splice(start, end - start + 1, ...replacement);
  }
}

function isRoot(node: Node): node is Root {
  return node.type === "root";
}

const tabsToMarkdown: ToMarkdownExtension = {
  handlers: {
    tabGroup: (node: TabGroup, _parent, state, info) => {
      const parts: string[] = [OPEN_LINE];
      for (const [index, panel] of node.children.entries()) {
        const body = state.containerFlow(panel, info);
        parts.push(`${index === 0 ? "" : "\n"}=== ${panel.label}${body === "" ? "" : `\n${body}`}`);
      }
      parts.push(CLOSE_LINE);
      return parts.join("\n");
    },
  },
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkTabs: Plugin = function (this: Processor): Transformer {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push(tabsToMarkdown);
  return (tree) => {
    if (isRoot(tree)) rewriteRoot(tree);
  };
};
