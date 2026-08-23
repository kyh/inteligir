// The html block: a self-contained interactive HTML artifact. Renders as a source card by default; "Preview" mounts a sandboxed
// srcdoc iframe with NO permissions, and "Run" re-mounts it with
// allow-scripts — a user-initiated escalation, never the default. There is no
// allow-same-origin under any mode: with scripts on, same-origin would hand
// the payload this origin's storage and API surface.
//
// Stated environment limit: the app's prod document CSP carries
// `frame-src 'none'` (apps/app/src/node/csp.ts), which blocks srcdoc frames —
// so the live preview works in dev and needs a deliberate `frame-src 'self'`
// (or an equivalent decision) to light up in prod. The source card is the
// prod-safe default either way.

import { type PlateElementProps, PlateElement } from "platejs/react";
import { useState } from "react";

import { DegradedPayloadView, RichBlockCard, PayloadEditor } from "./rich-block-chrome";
import { setBlockValue } from "./rich-block-value";

type HtmlMode = "source" | "preview" | "run";

function SourceView({ value }: { value: string }) {
  const lines = value.split("\n");
  const head = lines.slice(0, 12).join("\n");
  return (
    <pre className="max-h-48 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre text-muted-foreground">
      {head}
      {lines.length > 12 ? `\n… ${String(lines.length - 12)} more lines` : ""}
    </pre>
  );
}

export function HtmlElement(props: PlateElementProps) {
  const [mode, setMode] = useState<HtmlMode>("source");
  const [editing, setEditing] = useState(false);
  const value = typeof props.element.value === "string" ? props.element.value : "";

  const modeButton = (target: HtmlMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === target}
      className={
        mode === target
          ? "text-xs font-medium text-foreground"
          : "text-xs text-muted-foreground hover:text-foreground"
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
            {modeButton("run", "Run")}
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </button>
          </span>
        }
      >
        {editing ? (
          <PayloadEditor
            initial={value}
            validate={() => null}
            onCancel={() => {
              setEditing(false);
            }}
            onSave={(next) => {
              setBlockValue(props.editor, props.element, next);
              setEditing(false);
            }}
          />
        ) : value.trim() === "" ? (
          <DegradedPayloadView reason="Empty html block." value={value} />
        ) : mode === "source" ? (
          <SourceView value={value} />
        ) : (
          <>
            <iframe
              key={mode}
              title="HTML preview"
              srcDoc={value}
              sandbox={mode === "run" ? "allow-scripts" : ""}
              className="h-96 w-full border-0 bg-white print:hidden"
            />
            {/* A sandboxed srcdoc frame prints blank on some engines; paper
                gets the source, which is the block's honest byte content. */}
            <div className="hidden print:block">
              <SourceView value={value} />
            </div>
          </>
        )}
      </RichBlockCard>
      {props.children}
    </PlateElement>
  );
}
