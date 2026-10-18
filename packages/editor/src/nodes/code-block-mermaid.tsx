// The only module importing pele (about 250 kB gzipped), so it lands in a lazy chunk the first
// diagram loads; from then on a diagram draws synchronously on every change, with no debounce.

import { useLayoutEffect, useRef, useState } from "react";
import { mount, parse, PeleError } from "pele";
import type { Mounted, MountOptions } from "pele";

import { cn } from "@repo/ui/lib/cn";

import { inertSvg } from "@repo/editor/lib/inert-svg";
import { DIAGRAM_PREVIEW } from "@repo/editor/style-hooks";

// markup the guard could not read as one svg: a draw that fails, never an empty frame
class UnreadableDrawingError extends Error {
  override name = "UnreadableDrawingError";
}

// NOTHING REMOTE LOADS IN A NOTE (apps/cli/CLAUDE.md): a diagram's links and images are dropped,
// and no icon set is handed over, since Pele inserts an icon's markup unfiltered. Its colours and
// faces are the host's --pele-* variables (styles.css), so a theme change needs no redraw.
const OPTIONS = {
  images: false,
  links: false,
  sanitize: (svg) => {
    const drawn = inertSvg(svg);
    if (drawn === null) {
      throw new UnreadableDrawingError("the drawing is not one well-formed svg");
    }
    return drawn;
  },
  zoom: false,
} satisfies MountOptions;

// the appearance dials are written on the root element, and a face Pele measured its labels in
// is re-read only when asked, so a change there asks every drawing to measure again
const APPEARANCE_ATTRIBUTES = ["style", "class"];

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

// null for a throw that is not Pele's own, which has no place or reason to name
const failureOf = (error: PeleError | null): Failure =>
  error === null
    ? { reason: "This diagram could not be drawn.", snippet: "", where: "Diagram:" }
    : placed(error);

// parse raises a source's syntax failures, so those are known while rendering; what only the
// drawing finds (a gantt's impossible date, a sankey's cycle, the size cap) the effect reports
const failureIn = (code: string): Failure | null => {
  try {
    parse(code);
    return null;
  } catch (error: unknown) {
    return failureOf(error instanceof PeleError ? error : null);
  }
};

interface DrawFailure {
  readonly code: string;
  readonly failure: Failure;
}

const MermaidPreview = ({ code }: { code: string }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const parseFailure = failureIn(code);
  const parses = parseFailure === null;
  // what the last draw of this source failed with; one for an older source no longer applies
  const [drawFailure, setDrawFailure] = useState<DrawFailure | null>(null);
  const failure =
    parseFailure ??
    (drawFailure !== null && drawFailure.code === code ? drawFailure.failure : null);

  // a layout effect, so the drawing lands in the frame the keystroke paints, and a failure the
  // draw finds is said in that frame too. A source that fails keeps the last drawing it had,
  // dimmed, so typing through a half-written line does not collapse the block under the caret.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null || !parses) {
      return;
    }
    const failed = (error: PeleError | null): void => {
      setDrawFailure({ code, failure: failureOf(error) });
    };
    let mounted: Mounted;
    try {
      // a redraw on a resize or a font load reports through these; a draw that lands clears
      // what an earlier one of this source failed with
      mounted = mount(host, code, {
        ...OPTIONS,
        onError: (error) => {
          failed(error instanceof PeleError ? error : null);
        },
        onRender: () => {
          setDrawFailure(null);
        },
      });
    } catch (error: unknown) {
      failed(error instanceof PeleError ? error : null);
      return;
    }
    const appearance = new MutationObserver(() => {
      mounted.refresh();
    });
    appearance.observe(document.documentElement, {
      attributeFilter: APPEARANCE_ATTRIBUTES,
      attributes: true,
    });
    return () => {
      appearance.disconnect();
      mounted.destroy();
    };
  }, [code, parses]);

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
