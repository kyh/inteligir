// The only module importing pele (about 250 kB gzipped), so it lands in a lazy chunk the first
// diagram loads; from then on a diagram draws synchronously on every change, with no debounce.

import { useLayoutEffect, useRef } from "react";
import { mount, parse, PeleError } from "pele";
import type { Mounted, MountOptions } from "pele";

import { cn } from "@repo/ui/lib/cn";

import { inertSvg } from "@repo/editor/lib/inert-svg";
import { DIAGRAM_PREVIEW } from "@repo/editor/style-hooks";

// NOTHING REMOTE LOADS IN A NOTE (apps/cli/CLAUDE.md): a diagram's links and images are dropped,
// and no icon set is handed over, since Pele inserts an icon's markup unfiltered. Its colours and
// faces are the host's --pele-* variables (styles.css), so a theme change needs no redraw.
const OPTIONS = {
  images: false,
  links: false,
  sanitize: (svg) => inertSvg(svg) ?? document.createDocumentFragment(),
  zoom: false,
} satisfies MountOptions;

interface Failure {
  readonly reason: string;
  // the source line with a caret under the column, when the failure has a place
  readonly snippet: string;
  readonly where: string;
}

// jison's own header repeats the line the failure already names
const PARSER_HEADER = /^(?:Parse|Lexical) error on line \d+[.:]?\s*/u;

const placed = (error: PeleError): Failure => {
  const rest = error.snippet === "" ? error.message : error.message.replace(error.snippet, "");
  const reason = rest
    .split("\n")
    .map((line) => line.replace(PARSER_HEADER, "").trim())
    .filter((line) => line !== "")
    .join(" ");
  // a failure at the end of the source points at an empty line, which a caret adds nothing to
  const pointed = (error.snippet.split("\n")[0] ?? "").trim() !== "";
  return {
    reason: reason === "" ? error.message : reason,
    snippet: pointed ? error.snippet : "",
    where: error.line > 0 ? `Line ${error.line}, column ${error.column}:` : "Diagram:",
  };
};

// parse raises every failure a source can have but the drawing's own size cap, so the failure is
// known while rendering and the effect only draws
const failureIn = (code: string): Failure | null => {
  try {
    parse(code);
    return null;
  } catch (error: unknown) {
    return error instanceof PeleError
      ? placed(error)
      : { reason: "This diagram could not be drawn.", snippet: "", where: "Diagram:" };
  }
};

const MermaidPreview = ({ code }: { code: string }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const failure = failureIn(code);

  // a layout effect, so the drawing lands in the frame the keystroke paints. A source that fails
  // keeps the last drawing it had, dimmed, so typing through a half-written line does not collapse
  // the block under the caret.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null || failure !== null) {
      return;
    }
    let mounted: Mounted | null = null;
    try {
      mounted = mount(host, code, OPTIONS);
    } catch {
      // past the drawing's size cap: the last drawing stays
    }
    return () => {
      mounted?.destroy();
    };
  }, [code, failure]);

  return (
    <div contentEditable={false} className="my-1 select-none">
      {failure === null ? null : (
        <div className="mb-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-body text-destructive">
          <p>
            <span className="font-medium">{failure.where}</span> {failure.reason}
          </p>
          {failure.snippet === "" ? null : (
            <div className="mt-1 overflow-x-auto font-mono whitespace-pre text-caption">
              {failure.snippet}
            </div>
          )}
        </div>
      )}
      <div
        ref={hostRef}
        className={cn(
          DIAGRAM_PREVIEW,
          "flex justify-center rounded-md border border-border/60 px-4 py-3 empty:hidden [&_svg]:max-w-full",
          failure !== null && "opacity-40",
        )}
      />
    </div>
  );
};

export default MermaidPreview;
