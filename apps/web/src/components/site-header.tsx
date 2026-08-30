import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@repo/ui/lib/theme";

import { Button } from "@repo/ui/components/button";

import { siteConfig } from "@/lib/site-config";

const GITHUB_URL = "https://github.com/kyh/inteligir";
const TWITTER_URL = `https://x.com/${siteConfig.twitter.replace("@", "")}`;

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// Hydration gate: false through the server render and the hydrating one, true
// from the first client render on. There is nothing to subscribe to — the
// snapshot pair *is* the signal — so subscribe hands back a no-op unsubscribe.
const neverChanges = () => () => {};
const onClient = () => true;
const onServer = () => false;

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const mounted = useSyncExternalStore(neverChanges, onClient, onServer);

  const isDark = resolved === "dark";
  return (
    <Button
      variant="secondary"
      size="icon"
      className="rounded-full"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      {/* Render an invisible icon before mount to avoid a hydration mismatch
          while the theme provider reconciles from localStorage. */}
      {mounted && !isDark ? (
        <MoonIcon />
      ) : (
        <SunIcon className={mounted ? undefined : "opacity-0"} />
      )}
    </Button>
  );
}

export function SiteHeader() {
  return (
    <header className="fixed top-4 right-4 z-50 flex items-center gap-1">
      <ThemeToggle />
      {/* Social links are plain anchors styled to match the icon buttons
          beside them: they navigate, so the semantics are an anchor's. */}
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="GitHub"
        className="flex size-9 items-center justify-center rounded-full bg-accent text-foreground transition-colors hover:bg-accent/80"
      >
        <GithubIcon className="size-4" />
      </a>
      <a
        href={TWITTER_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="X (Twitter)"
        className="flex size-9 items-center justify-center rounded-full bg-accent text-foreground transition-colors hover:bg-accent/80"
      >
        <XIcon className="size-4" />
      </a>
    </header>
  );
}
