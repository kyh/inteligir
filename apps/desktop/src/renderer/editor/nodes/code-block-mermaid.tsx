// Mermaid preview for ```mermaid fences — render-only, zero serialization
// surface (the node stays a plain code_block; bytes on disk are the fence).
// The mermaid library (~2MB) is lazy-imported on first preview render so it
// never touches the initial chunk. Parse errors show an inline chip and keep
// the fence editable.

import { useEffect, useId, useRef, useState } from "react";

import { useDarkClass } from "@renderer/lib/use-dark-class";

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidPromise;
}

/**
 * Renders `code` as a mermaid diagram, debounced against typing. Re-renders
 * when the app theme flips (useDarkClass — mermaid bakes theme colors into
 * the emitted SVG).
 */
export function MermaidPreview({ code }: { code: string }) {
  // useId contains `:` which is invalid in the DOM id mermaid.render targets.
  const renderId = useId().replaceAll(":", "");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = useDarkClass();

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          securityLevel: "strict",
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
        });
        // Parse first: mermaid.render throws AND leaves an error artifact in
        // the DOM on bad input; parse gives a clean error path.
        await mermaid.parse(code);
        const { svg } = await mermaid.render(`mermaid-${renderId}`, code);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(
          e instanceof Error ? (e.message.split("\n")[0] ?? "Invalid diagram") : "Invalid diagram",
        );
      }
    };
    const handle = setTimeout(() => void render(), 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [code, dark, renderId]);

  return (
    <div contentEditable={false} className="my-1 select-none">
      {error ? (
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <span className="font-medium">Mermaid:</span>
          <span className="truncate">{error}</span>
        </div>
      ) : null}
      {/* Container matches the code fence's surface (PRE_CLASS family) so the
          block reads as one object across preview/source modes. */}
      <div
        ref={hostRef}
        className={
          error
            ? "hidden"
            : "flex justify-center rounded-md border border-border/60 bg-muted/30 px-4 py-3 [&_svg]:max-w-full"
        }
      />
    </div>
  );
}
