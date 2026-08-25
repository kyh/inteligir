// The gallery's own furniture. Deliberately plain — anything eye-catching
// here competes with the components it is supposed to be showing.

import { cn } from "@repo/ui/lib/utils";
import type { ReactNode } from "react";

export interface GallerySectionProps {
  /** Anchor id — must match the page's nav row. */
  id: string;
  title: string;
  children: ReactNode;
}

export function GallerySection({ id, title, children }: GallerySectionProps) {
  return (
    <section id={id} className="scroll-mt-10 space-y-6">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="space-y-8">{children}</div>
    </section>
  );
}

export interface DemoProps {
  /** The component's exported name, as a caller would import it. */
  name: string;
  /** What it is FOR — one line, in the reader's terms, not the API's. */
  purpose: string;
  /** Optional note about a state that cannot be shown, or a caveat. */
  note?: string | undefined;
  children: ReactNode;
  /** Lay the instances out in a column instead of a wrapping row. */
  stack?: boolean;
}

export function Demo({ name, purpose, note, children, stack = false }: DemoProps) {
  return (
    <article className="space-y-2">
      <header className="space-y-0.5">
        <h4 className="font-mono text-[13px] text-foreground">{name}</h4>
        <p className="text-xs text-muted-foreground">{purpose}</p>
      </header>
      <div
        className={cn(
          "rounded-lg border border-line bg-surface-raised p-4",
          stack ? "flex flex-col gap-4" : "flex flex-wrap items-center gap-3",
        )}
      >
        {children}
      </div>
      {note !== undefined ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </article>
  );
}

/** A caption for one instance inside a Demo, so a row of five buttons says
 *  which is which without the reader guessing from the rendering. */
export function DemoCase({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
