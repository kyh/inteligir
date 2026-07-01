import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";

import { useTheme } from "@repo/app/lib/use-theme";

/** Toggle light/dark. Persists to disk via use-theme. */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Toggle theme"
      title="Toggle theme"
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      className="size-7 px-0 text-muted-foreground hover:text-foreground"
    >
      {resolved === "dark" ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
    </Button>
  );
}
