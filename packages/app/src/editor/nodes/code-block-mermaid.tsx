// Mermaid preview for ```mermaid fences — render-only, zero serialization
// surface (the node stays a plain code_block; bytes on disk are the fence).
// The mermaid library (~2MB) is lazy-imported on first preview render so it
// never touches the initial chunk. Parse errors show an inline chip and keep
// the fence editable.

import { useEffect, useId, useRef, useState } from "react";

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  return mermaidPromise;
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Renders `code` as a mermaid diagram, debounced against typing. Re-renders
 * when the app theme flips (observes the root element's class attribute —
 * mermaid bakes theme colors into the emitted SVG).
 */
export function MermaidPreview({ code }: { code: string }) {
  // useId contains `:` which is invalid in the DOM id mermaid.render targets.
  const renderId = useId().replaceAll(":", "");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });
    return () => observer.disconnect();
  }, []);

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
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/[0.06] px-2 py-1 text-xs text-red-600 dark:text-red-400">
          <span className="font-medium">Mermaid:</span>
          <span className="truncate">{error}</span>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={error ? "hidden" : "flex justify-center [&_svg]:max-w-full"}
      />
    </div>
  );
}
