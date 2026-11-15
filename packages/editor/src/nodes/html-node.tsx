// Preview mounts a srcdoc iframe sandboxed with no permissions: it inherits the page's policy,
// which allows inline style and no script, so it draws the static first frame and runs nothing.
// Never allow-same-origin: it would hand the payload this origin's storage and API.

import type { PlateElementProps } from "platejs/react";
import { useState } from "react";

import { DegradedPayloadView, RichBlock } from "./rich-block-chrome";
import type { Parse } from "./rich-block-chrome";

type HtmlMode = "source" | "preview";

const FRAME_CLASS = "h-96 w-full border-0 bg-white print:hidden";

// any text is an html payload, an empty one included
const parseHtmlPayload = (value: string): Parse<string> => ({ ok: true, payload: value });

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
const HtmlView = ({ mode, value }: { mode: HtmlMode; value: string }) => {
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
    <RichBlock
      {...props}
      label="html"
      parse={parseHtmlPayload}
      renderView={(value) => <HtmlView mode={mode} value={value} />}
      viewActions={
        <>
          {modeButton("source", "Source")}
          {modeButton("preview", "Preview")}
        </>
      }
    />
  );
};
