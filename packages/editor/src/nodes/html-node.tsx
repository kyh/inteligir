// Preview mounts a srcdoc iframe sandboxed with no permissions: it inherits the page's policy,
// which allows inline style and no script, so it draws the static first frame and runs nothing.
// Never allow-same-origin: it would hand the payload this origin's storage and API.

import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { useState } from "react";

import { useRichBlocksLocked } from "@repo/editor/kits/rich-block-lock-kit";
import { stringProp } from "@repo/editor/node-props";

import { DegradedPayloadView, RichBlockCard, PayloadEditor } from "./rich-block-chrome";
import { setBlockValue } from "./rich-block-value";

type HtmlMode = "source" | "preview";

const FRAME_CLASS = "h-96 w-full border-0 bg-white print:hidden";

const SourceView = ({ value }: { value: string }) => {
  const lines = value.split("\n");
  const head = lines.slice(0, 12).join("\n");
  return (
    <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-body whitespace-pre text-muted-foreground">
      {head}
      {lines.length > 12 ? `\n… ${String(lines.length - 12)} more lines` : ""}
    </pre>
  );
};

// a sandboxed frame prints blank on some engines; print gets the source.
const HtmlBody = ({
  editing,
  mode,
  onCancel,
  onSave,
  value,
}: {
  editing: boolean;
  mode: HtmlMode;
  onCancel: () => void;
  onSave: (next: string) => void;
  value: string;
}) => {
  if (editing) {
    return (
      <PayloadEditor initial={value} validate={() => null} onCancel={onCancel} onSave={onSave} />
    );
  }
  if (value.trim() === "") {
    return <DegradedPayloadView reason="Empty html block." value={value} />;
  }
  if (mode === "source") {
    return <SourceView value={value} />;
  }
  return (
    <>
      <iframe title="HTML preview" srcDoc={value} sandbox="" className={FRAME_CLASS} />
      <div className="hidden print:block">
        <SourceView value={value} />
      </div>
    </>
  );
};

export const HtmlElement = (props: PlateElementProps) => {
  const [mode, setMode] = useState<HtmlMode>("source");
  const [editing, setEditing] = useState(false);
  const locked = useRichBlocksLocked();
  const value = stringProp(props.element, "value") ?? "";

  const modeButton = (target: HtmlMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === target}
      className={
        mode === target
          ? "text-body font-medium text-foreground"
          : "text-body text-muted-foreground hover:text-foreground"
      }
      onClick={() => {
        setMode(target);
      }}
    >
      {label}
    </button>
  );

  return (
    <PlateElement {...props}>
      <RichBlockCard
        label="html"
        actions={
          <span className="flex items-center gap-2">
            {modeButton("source", "Source")}
            {modeButton("preview", "Preview")}
            {locked ? null : (
              <button
                type="button"
                className="text-body text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
          </span>
        }
      >
        <HtmlBody
          editing={editing}
          mode={mode}
          value={value}
          onCancel={() => {
            setEditing(false);
          }}
          onSave={(next) => {
            setBlockValue(props.editor, props.element, next);
            setEditing(false);
          }}
        />
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
};
