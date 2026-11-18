import { useLayoutEffect, useRef, useState } from "react";
import { mount, parse, PeleError } from "pele";
import type { Mounted, MountOptions } from "pele";

import { cn } from "@repo/ui/lib/cn";

import { inertSvg } from "@repo/editor/lib/inert-svg";
import { DIAGRAM_PREVIEW } from "@repo/editor/style-hooks";

class UnreadableDrawingError extends Error {
  override name = "UnreadableDrawingError";
}

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

const APPEARANCE_ATTRIBUTES = ["style", "class"];

interface Failure {
  readonly reason: string;
  readonly snippet: string;
  readonly where: string;
}

const PARSER_HEADER = /^(?:Parse|Lexical) error on line \d+[.:]?\s*/u;

const placed = (error: PeleError) => {
  const rest = error.snippet === "" ? error.message : error.message.replace(error.snippet, "");

  const reason = rest
    .split("\n")
    .map((line) => line.replace(PARSER_HEADER, "").trim())
    .filter((line) => line !== "")
    .join(" ");

  const pointed = (error.snippet.split("\n")[0] ?? "").trim() !== "";

  return {
    reason: reason === "" ? error.message : reason,
    snippet: pointed ? error.snippet : "",
    where: error.line > 0 ? `Line ${error.line}, column ${error.column}:` : "Diagram:",
  } satisfies Failure;
};

const failureOf = (error: PeleError | null) =>
  (error === null
    ? { reason: "This diagram could not be drawn.", snippet: "", where: "Diagram:" }
    : placed(error)) satisfies Failure;

const failureIn = (code: string) => {
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
  const [drawFailure, setDrawFailure] = useState<DrawFailure | null>(null);
  const failure = parseFailure ?? (drawFailure?.code === code ? drawFailure.failure : null);

  useLayoutEffect(() => {
    const host = hostRef.current;

    if (host === null || !parses) {
      return;
    }

    const failed = (error: PeleError | null) => {
      setDrawFailure({ code, failure: failureOf(error) });
    };

    let mounted: Mounted;

    try {
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
