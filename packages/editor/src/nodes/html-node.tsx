// Preview mounts a srcdoc iframe sandboxed with no permissions: it inherits the page's policy,
// which allows inline style and no script, so it draws the static first frame. Run is a
// user-initiated escalation to the host's html frame, a same-origin document under a sandbox
// policy of its own that runs inline script and reaches nothing. Never allow-same-origin: with
// scripts on it would hand the payload this origin's storage and API.

import { PlateElement } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import { useRef, useState } from "react";

import { getEditorHostIo } from "@repo/editor/host-io";
import { stringProp } from "@repo/editor/node-props";

import { DegradedPayloadView, RichBlockCard, PayloadEditor } from "./rich-block-chrome";
import { setBlockValue } from "./rich-block-value";

type HtmlMode = "source" | "preview" | "run";

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

// the frame's document.write fires its load again, so the bytes are posted on the first load
// alone. "*": an opaque origin has no name to target, and the frame is this origin's own loader.
const RunFrame = ({ value }: { value: string }) => {
  const posted = useRef(false);
  return (
    <iframe
      title="HTML run"
      src={getEditorHostIo().htmlFrameUrl}
      sandbox="allow-scripts"
      className={FRAME_CLASS}
      onLoad={(event) => {
        if (posted.current) {
          return;
        }
        posted.current = true;
        event.currentTarget.contentWindow?.postMessage(value, "*");
      }}
    />
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
      {mode === "run" ? (
        <RunFrame key={value} value={value} />
      ) : (
        <iframe title="HTML preview" srcDoc={value} sandbox="" className={FRAME_CLASS} />
      )}
      <div className="hidden print:block">
        <SourceView value={value} />
      </div>
    </>
  );
};

export const HtmlElement = (props: PlateElementProps) => {
  const [mode, setMode] = useState<HtmlMode>("source");
  const [editing, setEditing] = useState(false);
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
            {modeButton("run", "Run")}
            <button
              type="button"
              className="text-body text-muted-foreground hover:text-foreground"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </button>
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
