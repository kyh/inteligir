import { createFileRoute } from "@tanstack/react-router";

import { HeroOrb } from "@/components/hero-orb";
import { siteConfig } from "@/lib/site-config";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <HeroOrb />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          {siteConfig.name}
        </h1>
        <p className="text-muted-foreground max-w-md text-lg">
          {siteConfig.description}
        </p>
        <a
          href="https://github.com/kyh/inteligir/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-8 py-3 text-sm font-medium transition-colors"
        >
          Download for macOS
        </a>
      </div>
    </main>
  );
}
