import { Elevated } from "@repo/ui/lib/elevated";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { cn } from "cn";

import { Demo, GallerySection } from "./gallery-chrome";

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const INK = [
  { className: "bg-background text-foreground", name: "background" },
  { className: "bg-surface text-ink", name: "surface" },
  { className: "bg-surface-raised text-ink", name: "surface-raised" },
  { className: "bg-surface-inset text-ink", name: "surface-inset" },
  { className: "bg-muted text-muted-foreground", name: "muted" },
  { className: "bg-primary text-primary-foreground", name: "primary" },
  { className: "bg-destructive text-destructive-foreground", name: "destructive" },
  { className: "bg-hover text-foreground", name: "hover" },
];

export const TokensSection = () => (
  <GallerySection id="tokens" title="Tokens">
    <Demo
      name="Surface ladder"
      purpose="Eight steps of elevation. Light separates by color then by shadow; dark adds white."
      stack
    >
      <div className="flex flex-wrap gap-3">
        {LEVELS.map((level) => (
          <div
            key={level}
            className={cn(
              "flex size-16 items-center justify-center rounded-lg font-mono text-[11px] text-ink",
              surfaceClasses(level),
            )}
          >
            {level}
          </div>
        ))}
      </div>
    </Demo>

    <Demo
      name="Elevated"
      purpose="Raises its children one step and tells the subtree it moved, so nesting stays honest."
      stack
    >
      <Elevated offset={1} className="w-64 rounded-lg p-4">
        <p className="text-sm text-ink">One step up.</p>
        <Elevated offset={1} className="mt-3 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">And one step up from there.</p>
        </Elevated>
      </Elevated>
    </Demo>

    <Demo
      name="Ink and fills"
      purpose="The named pairs — a fill and the text color that belongs on it."
    >
      {INK.map((token) => (
        <div
          key={token.name}
          className={cn(
            "flex h-16 w-32 items-center justify-center rounded-lg border border-line font-mono text-[11px]",
            token.className,
          )}
        >
          {token.name}
        </div>
      ))}
    </Demo>
  </GallerySection>
);
