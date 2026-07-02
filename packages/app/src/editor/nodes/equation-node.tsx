/* Adapted from Plate Plus Potion (https://pro.platejs.org) — used under the
 * held Plate Plus license. */
// Equation nodes ($$ block / $$x$$ inline): KaTeX preview (lazy chunk — see
// equation-katex.tsx) with click-to-edit raw TeX in a popover textarea.
// Editing writes the node's `texExpression`; Enter/Done commits and closes,
// Escape restores the expression the popover opened with.

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { RadicalIcon } from "lucide-react";
import type { TElement } from "platejs";
import {
  PlateElement,
  useEditorRef,
  useElement,
  useReadOnly,
  useSelected,
  type PlateElementProps,
} from "platejs/react";

import { cn } from "@repo/ui/lib/utils";

import {
  NodePopover,
  NodePopoverContent,
  NodePopoverTrigger,
} from "@repo/app/editor/nodes/node-popover";

const KatexView = lazy(() => import("@repo/app/editor/nodes/equation-katex"));

function tex(element: TElement): string {
  return typeof element.texExpression === "string" ? element.texExpression : "";
}

// Re-derivation of @platejs/math's useEquationInput (the package is not a
// dependency — its base plugin eagerly imports katex; see math-kit.tsx).
function EquationEditor({
  isInline,
  onClose,
  placeholder,
}: {
  isInline: boolean;
  onClose: () => void;
  placeholder: string;
}) {
  const editor = useEditorRef();
  const element = useElement();
  const initial = useRef(tex(element));
  const [value, setValue] = useState(initial.current);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const write = (next: string) => {
    setValue(next);
    const at = editor.api.findPath(element);
    if (at) editor.tf.setNodes({ texExpression: next }, { at });
  };

  const dismiss = () => {
    const at = editor.api.findPath(element);
    if (at) editor.tf.setNodes({ texExpression: initial.current }, { at });
    onClose();
  };

  return (
    <div className="flex items-end gap-2 p-2" contentEditable={false}>
      <textarea
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        rows={isInline ? 1 : Math.max(2, value.split("\n").length)}
        spellCheck={false}
        className="max-h-[40vh] min-w-64 grow resize-none rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none"
        onChange={(e) => write(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onClose();
          } else if (e.key === "Escape") {
            e.preventDefault();
            dismiss();
          }
        }}
      />
      <button
        type="button"
        onClick={onClose}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
      >
        Done
      </button>
    </div>
  );
}

function useEquationPopover() {
  const editor = useEditorRef();
  const element = useElement();
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    // Put the caret after the node so typing continues naturally.
    editor.tf.select(element, { focus: true, next: true });
  };
  return { close, open, setOpen };
}

export function EquationElement(props: PlateElementProps) {
  const readOnly = useReadOnly();
  const selected = useSelected();
  const { close, open, setOpen } = useEquationPopover();
  const expression = tex(props.element);

  return (
    <PlateElement {...props} className="my-1">
      <NodePopover open={open} onOpenChange={(next) => !readOnly && setOpen(next)}>
        <NodePopoverTrigger
          // A <button> can't contain KaTeX's block-level display markup.
          render={<div role="button" />}
          nativeButton={false}
          className={cn(
            "flex w-full cursor-pointer items-center justify-center rounded-sm transition-colors select-none hover:bg-primary/10",
            selected && "bg-primary/10",
            expression.length === 0 ? "bg-muted p-3" : "px-2 py-1",
          )}
          contentEditable={false}
        >
          {expression.length > 0 ? (
            <Suspense fallback={<span className="font-mono text-sm opacity-60">{expression}</span>}>
              <KatexView tex={expression} displayMode className="[&_.katex-display]:my-0" />
            </Suspense>
          ) : (
            <span className="flex h-7 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
              <RadicalIcon className="size-5" />
              Add a TeX equation
            </span>
          )}
        </NodePopoverTrigger>
        <NodePopoverContent className="p-0">
          <EquationEditor
            isInline={false}
            onClose={close}
            placeholder={"f(x) = \\begin{cases}\n  x^2, &\\quad x > 0 \\\\\n  0, &\\quad x = 0\n\\end{cases}"}
          />
        </NodePopoverContent>
      </NodePopover>
      {props.children}
    </PlateElement>
  );
}

export function InlineEquationElement(props: PlateElementProps) {
  const readOnly = useReadOnly();
  const selected = useSelected();
  const { close, open, setOpen } = useEquationPopover();
  const expression = tex(props.element);

  return (
    <PlateElement {...props} as="span" className="mx-px inline-block rounded-sm select-none">
      <NodePopover open={open} onOpenChange={(next) => !readOnly && setOpen(next)}>
        <NodePopoverTrigger
          // Inline chip stays a span (a nested <button> would break the line).
          render={<span role="button" />}
          nativeButton={false}
          className={cn(
            "cursor-pointer rounded-sm px-0.5 transition-colors hover:bg-primary/10",
            (open || selected) && "bg-primary/15",
            expression.length === 0 && "text-muted-foreground",
          )}
          contentEditable={false}
        >
          {expression.length > 0 ? (
            <Suspense fallback={<span className="font-mono text-sm opacity-60">{expression}</span>}>
              <KatexView
                tex={expression}
                displayMode={false}
                className="leading-none [&_.katex-display]:my-0"
              />
            </Suspense>
          ) : (
            <span>
              <RadicalIcon className="mr-1 inline-block size-4 align-text-bottom" />
              New equation
            </span>
          )}
        </NodePopoverTrigger>
        <NodePopoverContent className="p-0">
          <EquationEditor isInline onClose={close} placeholder="E = mc^2" />
        </NodePopoverContent>
      </NodePopover>
      {props.children}
    </PlateElement>
  );
}
