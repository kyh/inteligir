// mermaid (~2MB) is lazy-imported on first preview render.

import { useEffect, useId, useRef, useState } from "react";

import { useDarkClass } from "@repo/editor/lib/use-dark-class";

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidPromise;
}

export function MermaidPreview({ code }: { code: string }) {
  // useId contains `:`, invalid in the DOM id mermaid.render targets.
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
        // parse first: mermaid.render throws and leaves an error artifact in the DOM on bad input.
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
