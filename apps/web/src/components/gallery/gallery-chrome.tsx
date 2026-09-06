import { cn } from "cn";
import type { ReactNode } from "react";

export interface GallerySectionProps {
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
  name: string;
  purpose: string;
  note?: string | undefined;
  children: ReactNode;
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

export function DemoCase({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
