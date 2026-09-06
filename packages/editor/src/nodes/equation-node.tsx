// Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.

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

import { cn } from "cn";
import { Button } from "@repo/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";

import { stringProp } from "@repo/editor/node-props";

const KatexView = lazy(() => import("@repo/editor/nodes/equation-katex"));

function tex(element: TElement): string {
  return stringProp(element, "texExpression") ?? "";
}

// re-derives @platejs/math's useEquationInput; the package eagerly imports katex (math-kit.tsx).
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
  const [initial] = useState(() => tex(element));
  const [value, setValue] = useState(initial);
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
    if (at) editor.tf.setNodes({ texExpression: initial }, { at });
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
      <Button onClick={onClose} className="rounded-md">
        Done
      </Button>
    </div>
  );
}

function useEquationPopover() {
  const editor = useEditorRef();
  const element = useElement();
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    editor.tf.select(element, { focus: true, next: true });
  };
  return { close, open, setOpen };
}

export function EquationElement(props: PlateElementProps) {
  const readOnly = useReadOnly();
  const selected = useSelected();
  const { close, open, setOpen } = useEquationPopover();
  const expression = tex(props.element);

  // the trigger is a div: a <button> cannot contain KaTeX's block-level display markup.
  return (
    <PlateElement {...props} className="my-1">
      <Popover open={open} onOpenChange={(next) => !readOnly && setOpen(next)}>
        <PopoverTrigger
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
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <EquationEditor
            isInline={false}
            onClose={close}
            placeholder={
              "f(x) = \\begin{cases}\n  x^2, &\\quad x > 0 \\\\\n  0, &\\quad x = 0\n\\end{cases}"
            }
          />
        </PopoverContent>
      </Popover>
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
      <Popover open={open} onOpenChange={(next) => !readOnly && setOpen(next)}>
        <PopoverTrigger
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
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <EquationEditor isInline onClose={close} placeholder="E = mc^2" />
        </PopoverContent>
      </Popover>
      {props.children}
    </PlateElement>
  );
}
