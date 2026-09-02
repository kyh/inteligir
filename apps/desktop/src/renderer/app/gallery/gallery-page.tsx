// not a consumer for the orphan guard: a gallery proves a component renders, not that the product needs it.

import { Button } from "@repo/ui/components/button";
import { useTheme, type Theme } from "@repo/ui/lib/theme";
import { cn } from "@repo/ui/lib/utils";
import { ArrowLeftIcon } from "lucide-react";

import { ActionsSection } from "./actions-section";
import { AgentSection } from "./agent-section";
import { DataSection } from "./data-section";
import { EditingSection } from "./editing-section";
import { FeedbackSection } from "./feedback-section";
import { InputsSection } from "./inputs-section";
import { NavigationSection } from "./navigation-section";
import { OverlaysSection } from "./overlays-section";
import { TokensSection } from "./tokens-section";

// each id must match a GallerySection id.
const NAV = [
  { id: "actions", label: "Actions" },
  { id: "inputs", label: "Inputs" },
  { id: "overlays", label: "Overlays" },
  { id: "feedback", label: "Feedback" },
  { id: "navigation", label: "Navigation" },
  { id: "agent", label: "Agent surfaces" },
  { id: "data", label: "Data" },
  { id: "editing", label: "Editing" },
  { id: "tokens", label: "Tokens" },
] as const;

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function GalleryPage({ onBack }: { onBack: () => void }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-dvh overflow-y-auto bg-surface text-ink">
      <div className="mx-auto flex max-w-4xl gap-10 px-6 py-10">
        <nav className="sticky top-10 hidden w-40 shrink-0 self-start md:block">
          <Button variant="ghost" size="compact" className="-ml-2 mb-6 gap-1.5" onClick={onBack}>
            <ArrowLeftIcon />
            Notes
          </Button>
          <ul className="space-y-1 text-sm">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-6 space-y-1">
            <p className="px-2 text-[11px] tracking-wide text-muted-foreground uppercase">Theme</p>
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setTheme(option.value);
                }}
                className={cn(
                  "block w-full rounded-md px-2 py-1 text-left text-sm",
                  theme === option.value
                    ? "bg-hover text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1 space-y-12">
          <header className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label="Back to notes"
              className="md:hidden"
              onClick={onBack}
            >
              <ArrowLeftIcon />
            </Button>
            <div>
              <h2 className="text-lg font-semibold">Components</h2>
              <p className="text-sm text-muted-foreground">
                Every component in @repo/ui, with the states worth seeing.
              </p>
            </div>
          </header>

          <ActionsSection />
          <InputsSection />
          <OverlaysSection />
          <FeedbackSection />
          <NavigationSection />
          <AgentSection />
          <DataSection />
          <EditingSection />
          <TokensSection />
        </main>
      </div>
    </div>
  );
}
