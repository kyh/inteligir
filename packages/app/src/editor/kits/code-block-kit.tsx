// Code block kit. Base half feeds the headless serialization mirror; the
// React half adds lowlight syntax highlighting, the ``` autoformat rule, and
// a render-only mermaid preview on `lang === "mermaid"` fences (toggle between
// diagram and source; the node model never changes, so bytes stay canonical).

import { useState } from "react";
import { CodeIcon, EyeIcon } from "lucide-react";
import { NodeApi } from "platejs";
import {
  PlateElement,
  PlateLeaf,
  type PlateElementProps,
  type PlateLeafProps,
} from "platejs/react";
import { BaseCodeBlockPlugin, BaseCodeLinePlugin, CodeBlockRules } from "@platejs/code-block";
import { CodeBlockPlugin, CodeLinePlugin, CodeSyntaxPlugin } from "@platejs/code-block/react";
import { common, createLowlight } from "lowlight";

import { cn } from "@repo/ui/lib/utils";

import { MermaidPreview } from "@repo/app/editor/nodes/code-block-mermaid";

export const CodeBlockBaseKit = [BaseCodeBlockPlugin, BaseCodeLinePlugin];

// lowlight powers code-block syntax highlighting (`common` = ~35 popular
// languages; the token classes are styled by the `.hljs-*` theme in styles.css).
const lowlight = createLowlight(common);
// Fence languages we render but lowlight doesn't ship grammars for — alias to
// plaintext (no tokens) so CodeSyntaxPlugin stops logging "not registered" on
// every mermaid/math note.
lowlight.registerAlias("plaintext", ["mermaid", "math"]);

const PRE_CLASS =
  "my-1 overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-sm leading-normal [tab-size:2]";

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
    <PlateElement {...props} className="group/mermaid relative my-1">
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
      <pre className={cn(PRE_CLASS, mode === "preview" && "hidden")}>{props.children}</pre>
      <MermaidPreview code={codeText(props.element)} />
    </PlateElement>
  );
}

function CodeBlockElement(props: PlateElementProps) {
  if (props.element.lang === "mermaid") return <MermaidCodeBlock {...props} />;
  const lang = typeof props.element.lang === "string" ? props.element.lang : null;
  return (
    <PlateElement {...props} as="pre" className={cn(PRE_CLASS, "group/code relative")}>
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

export const CodeBlockKit = [
  CodeBlockPlugin.configure({
    inputRules: [CodeBlockRules.markdown({ on: "match" })],
    options: { lowlight },
  }).withComponent(CodeBlockElement),
  CodeLinePlugin.withComponent(CodeLineElement),
  CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
];
