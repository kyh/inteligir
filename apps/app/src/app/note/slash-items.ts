// The slash menu's vocabulary. DATA, not machinery: `@repo/editor` owns the
// trigger, the filter, the rendering and the one transaction, and every row
// below is either markdown it inserts or a seam this app already has.
//
// THE LIST IS BOUNDED BY WHAT THE EDITOR DRAWS. Every insertion re-parses to
// a construct `markdownEditorExtensions` decorates — asserted per row in
// __tests__/slash-items.test.ts against the editor's own grammar, so a row
// cannot outlive the extension that renders it.
//
// THE TWO AGENT ROWS REACH `draftFor`, the same closure the selection
// tooltip's Delegate/Propose/Ask reach. A menu that armed a delegation its own
// way would be a second dispatch path over one thread service, and the two
// would drift the first time an anchor rule changed.

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import type { SlashBlock, SlashItem } from "@repo/editor/slash-menu";
import type { DelegationIntent } from "../chat/chat-model";

export interface NoteSlashHandlers {
  /** Where a delegated turn's writes land. Read when the menu OPENS, which is
   *  what lets the row's label state what picking it will do — the same
   *  bargain the checkbox fast path's label makes. */
  writeMode: () => AgentWriteMode;
  /** The one delegation seam, shared with the selection tooltip. */
  onDelegate: (intent: DelegationIntent, writeMode: AgentWriteMode, block: SlashBlock) => void;
}

/** Three lines of GFM: a header row, the delimiter row that makes it a table,
 *  and one body row to type into. */
const TABLE = "| Column | Column |\n| --- | --- |\n|  |  |";

function insert(
  id: string,
  label: string,
  hint: string,
  text: string,
  caret: number,
  keywords: readonly string[],
): SlashItem {
  return { id, label, hint, keywords, action: { kind: "insert", text, caret } };
}

export function noteSlashItems(handlers: NoteSlashHandlers): SlashItem[] {
  const writeMode = handlers.writeMode();
  const delegate = (
    id: string,
    label: string,
    intent: DelegationIntent,
    mode: AgentWriteMode,
  ): SlashItem => ({
    id,
    label,
    keywords: ["agent", "delegate"],
    action: {
      kind: "handoff",
      run: (block) => handlers.onDelegate(intent, mode, block),
    },
  });

  return [
    insert("heading-1", "Heading 1", "#", "# ", 2, ["h1", "title"]),
    insert("heading-2", "Heading 2", "##", "## ", 3, ["h2", "section"]),
    insert("heading-3", "Heading 3", "###", "### ", 4, ["h3", "subsection"]),
    insert("bullet-list", "Bullet list", "-", "- ", 2, ["ul", "unordered", "list"]),
    insert("numbered-list", "Numbered list", "1.", "1. ", 3, ["ol", "ordered", "list"]),
    insert("task-list", "Task", "- [ ]", "- [ ] ", 6, ["todo", "checkbox", "list"]),
    insert("quote", "Quote", ">", "> ", 2, ["blockquote"]),
    insert("callout", "Callout", "> [!NOTE]", "> [!NOTE] ", 10, ["note", "warning", "admonition"]),
    // `***`, NOT `---`, and the reason is position: prosemark's frontmatter
    // parser fires at line 0 and takes any later `---` as its closer, so a
    // dash divider written at the top of a note turns the whole note into
    // frontmatter the moment a second one lands — the prose below it becomes
    // YAML the knowledge index reads as properties. `***` is the same
    // CommonMark thematic break and the same `HorizontalRule` node, and it
    // cannot open frontmatter from any position.
    insert("divider", "Divider", "***", "***\n", 4, ["hr", "rule", "separator"]),
    // The caret lands in the body rather than on the info string: code is what
    // a fence is for, and its language is one line up when it is wanted.
    insert("code-block", "Code block", "```", "```\n\n```", 4, ["fence", "snippet"]),
    insert("table", "Table", "|", TABLE, 2, ["grid", "columns"]),
    // No blank line between the delimiters: display math with one inside is a
    // different (block) parse that needs content BEFORE the blank to fire at
    // all, so an empty `$$\n\n$$` skeleton would be two paragraphs of literal
    // dollars until the user happened to fill it in.
    insert("math-block", "Math block", "$$", "$$\n$$", 3, ["latex", "katex", "formula"]),
    // Empty, with the caret between the parens: the path is the only part the
    // editor cannot guess, and until one is typed the embed says so itself.
    insert("image", "Image", "![]()", "![]()", 4, ["picture", "embed"]),
    // `ask` writes nothing, so it names no mode — exactly as the selection
    // tooltip's third button does.
    delegate("agent-ask", "Ask the agent…", "ask", "direct"),
    delegate(
      "agent-write",
      writeMode === "propose" ? "Have the agent suggest…" : "Have the agent write…",
      "do",
      writeMode,
    ),
  ];
}
