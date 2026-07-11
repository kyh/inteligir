// Code block kit. Base half feeds the headless serialization mirror; the
// React half adds lowlight syntax highlighting, the ``` autoformat rule, and
// a render-only mermaid preview on `lang === "mermaid"` fences (toggle between
// diagram and source; the node model never changes, so bytes stay canonical).

import { useState } from "react";
import { CodeIcon, EyeIcon } from "lucide-react";
import { KEYS, NodeApi } from "platejs";
import {
  PlateElement,
  PlateLeaf,
  type PlateEditor,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";
import { BaseCodeBlockPlugin, BaseCodeLinePlugin, CodeBlockRules } from "@platejs/code-block";
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { common, createLowlight } from "lowlight";

import { cn } from "@repo/ui/lib/utils";

import { TURN_INTO, turnIntoSelection } from "@renderer/editor/block-transforms";
import { MermaidPreview } from "@renderer/editor/nodes/code-block-mermaid";

export const CodeBlockBaseKit = [BaseCodeBlockPlugin, BaseCodeLinePlugin];

// lowlight powers code-block syntax highlighting (`common` = ~35 popular
// languages; the token classes are styled by the `.hljs-*` theme in styles.css).
const lowlight = createLowlight(common);
// Fence languages we render but lowlight doesn't ship grammars for — alias to
// plaintext (no tokens) so CodeSyntaxPlugin stops logging "not registered" on
// every mermaid/math note.
lowlight.registerAlias("plaintext", ["mermaid", "math"]);

// Code-block typography (mono, bg, radius, padding, overflow, tab-size) comes
// from typeset's `pre` rules.

// CodeSyntaxPlugin tags each highlighted token with an `.hljs-*` className on
// the leaf; render it so the theme in styles.css colors it.
function CodeSyntaxLeaf(props: PlateLeafProps) {
  const { className } = props.leaf;
  return <PlateLeaf {...props} className={typeof className === "string" ? className : ""} />;
}

// Code lines are sibling elements — NodeApi.string on the block concatenates
// them without separators, so join per line for the diagram source.
function codeText(element: PlateElementProps["element"]): string {
  return element.children.map((line) => NodeApi.string(line)).join("\n");
}

function MermaidCodeBlock(props: PlateElementProps) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const { editor } = props;

  const showPreview = () => {
    // Hiding the fence while the selection sits inside it would strand Slate's
    // DOM selection in an invisible subtree — drop the selection first.
    if (editor.selection && editor.api.some({ match: (n) => n === props.element })) {
      editor.tf.deselect();
    }
    setMode("preview");
  };

  return (
    <PlateElement {...props} className="group/mermaid relative">
      <div contentEditable={false} className="absolute top-1.5 right-1.5 z-10 select-none">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (mode === "preview" ? setMode("source") : showPreview())}
          title={mode === "preview" ? "Edit source" : "Show diagram"}
          className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/mermaid:opacity-100 hover:bg-accent hover:text-foreground"
        >
          {mode === "preview" ? <CodeIcon className="size-3" /> : <EyeIcon className="size-3" />}
          {mode === "preview" ? "Source" : "Diagram"}
        </button>
      </div>
      <pre className={cn("mt-0", mode === "preview" && "hidden")}>{props.children}</pre>
      <MermaidPreview code={codeText(props.element)} />
    </PlateElement>
  );
}

function CodeBlockElement(props: PlateElementProps) {
  if (props.element.lang === "mermaid") return <MermaidCodeBlock {...props} />;
  const lang = typeof props.element.lang === "string" ? props.element.lang : null;
  return (
    <PlateElement {...props} as="pre" className="group/code relative">
      {/* Hover-reveal language label (display-only header — the fence's lang
          is edited in Raw / at creation). A <span>: <pre> hosts phrasing. */}
      {lang ? (
        <span
          contentEditable={false}
          className="absolute top-1.5 right-2 font-sans text-[10px] tracking-wide text-muted-foreground/80 uppercase opacity-0 transition-opacity select-none group-hover/code:opacity-100"
        >
          {lang}
        </span>
      ) : null}
      {props.children}
    </PlateElement>
  );
}

function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...props} as="div" />;
}

// A mermaid diagram is a plain ```mermaid fence (render-only preview — zero
// serialization surface), seeded with a minimal valid graph. Reuses the "Code
// block" turn-into so the fence's byte-form matches every other code block's.
export function insertMermaid(editor: PlateEditor): void {
  const codeBlock = TURN_INTO.find((opt) => opt.label === "Code block");
  if (codeBlock) turnIntoSelection(editor, codeBlock);
  editor.tf.setNodes(
    { lang: "mermaid" },
    { match: (n) => n.type === editor.getType(KEYS.codeBlock) },
  );
  editor.tf.insertText("graph TD;");
  editor.tf.insertBreak();
  editor.tf.insertText("  A-->B;");
}

export const CodeBlockKit = [
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: "match" })],
    options: { lowlight },
  }).withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
];
