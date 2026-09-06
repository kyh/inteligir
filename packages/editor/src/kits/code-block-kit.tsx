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

import { cn } from "cn";

import { turnIntoOption, turnIntoSelection } from "@repo/editor/block-transforms";
import { stringProp } from "@repo/editor/node-props";
import { MermaidPreview } from "@repo/editor/nodes/code-block-mermaid";

export const CodeBlockBaseKit = [BaseCodeBlockPlugin, BaseCodeLinePlugin];

const lowlight = createLowlight(common);
// lowlight ships no mermaid/math grammar; without the alias CodeSyntaxPlugin logs "not registered" per fence.
lowlight.registerAlias("plaintext", ["mermaid", "math"]);

function CodeSyntaxLeaf(props: PlateLeafProps) {
  return <PlateLeaf {...props} className={stringProp(props.leaf, "className") ?? ""} />;
}

// NodeApi.string on the block joins code lines with no separator.
function codeText(element: PlateElementProps["element"]): string {
  return element.children.map((line) => NodeApi.string(line)).join("\n");
}

function MermaidCodeBlock(props: PlateElementProps) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const { editor } = props;

  const showPreview = () => {
    // hiding the fence with the selection inside strands Slate's DOM selection in an invisible subtree.
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
  const lang = stringProp(props.element, "lang");
  return (
    <PlateElement {...props} as="pre" className="group/code relative">
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

// Goes through the code-block turn-into so the fence's byte form matches every other code block's.
export function insertMermaid(editor: PlateEditor): void {
  turnIntoSelection(editor, turnIntoOption("code-block"));
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
