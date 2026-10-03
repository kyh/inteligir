import { Suspense, lazy } from "react";
import type { ComponentProps } from "react";
import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import Markdown from "react-markdown";
import type { ExtraProps } from "react-markdown";

import { markdownHandler, varyHeaders } from "@/lib/markdown-route";
import { siteConfig } from "@/lib/site-config";
import { homeMarkdown } from "@/lib/site-content";
import { SiteHeader } from "@/components/site-header";

// three.js is most of this page's weight; imported statically it would hold hydration, and the CTA with it
const HeroOrb = lazy(async () => {
  const module = await import("@/components/hero-orb");
  return { default: module.HeroOrb };
});

// themed tokens, not literal hex: dark is the default theme, so a hardcoded near-black pill vanishes into it
const CTA_PILL =
  "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium shadow-lg";

const MacLogoIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" aria-hidden>
    <path d="M849.124134 704.896288c-1.040702 3.157923-17.300015 59.872622-57.250912 118.190843-34.577516 50.305733-70.331835 101.018741-126.801964 101.909018-55.532781 0.976234-73.303516-33.134655-136.707568-33.134655-63.323211 0-83.23061 32.244378-135.712915 34.110889-54.254671 2.220574-96.003518-54.951543-130.712017-105.011682-70.934562-102.549607-125.552507-290.600541-52.30118-416.625816 36.040844-63.055105 100.821243-103.135962 171.364903-104.230899 53.160757-1.004887 103.739712 36.012192 136.028093 36.012192 33.171494 0 94.357018-44.791136 158.90615-38.089503 27.02654 1.151219 102.622262 11.298324 151.328567 81.891102-3.832282 2.607384-90.452081 53.724599-89.487104 157.76107C739.079832 663.275355 847.952448 704.467523 849.124134 704.896288M633.69669 230.749408c29.107945-35.506678 48.235584-84.314291 43.202964-132.785236-41.560558 1.630127-92.196819 27.600615-122.291231 62.896492-26.609031 30.794353-50.062186 80.362282-43.521213 128.270409C557.264926 291.935955 604.745311 264.949324 633.69669 230.749408" />
  </svg>
);

const LEGAL_LINKS = [
  { label: "Privacy", to: "/privacy" },
  { label: "Terms", to: "/terms" },
] as const;

const HIDDEN_FOOTER_LINKS = [
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
] as const;

// links in sr-only text would otherwise be tab stops a sighted keyboard user cannot see
const UntabbableAnchor = ({
  node: _node,
  children,
  ...props
}: ComponentProps<"a"> & ExtraProps) => (
  <a {...props} tabIndex={-1}>
    {children}
  </a>
);

const Page = () => (
  <>
    <SiteHeader />
    <main className="flex min-h-dvh w-full flex-col">
      <section className="sr-only">
        <Markdown components={{ a: UntabbableAnchor }}>{homeMarkdown}</Markdown>
      </section>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="h-48 w-48">
          <ClientOnly fallback={null}>
            <Suspense fallback={null}>
              <HeroOrb />
            </Suspense>
          </ClientOnly>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 pb-10">
        <a
          href={siteConfig.downloadUrl}
          className={`${CTA_PILL} bg-primary text-primary-foreground transition-opacity duration-200 ease hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        >
          <MacLogoIcon className="size-5 shrink-0" />
          Download for Mac
        </a>
        <span className="text-center text-xs text-foreground/60">
          For Macs with Apple silicon. The agent works with a paid Claude plan or any ChatGPT plan.
        </span>
      </div>
      <footer className="flex justify-center gap-4 pb-6">
        {LEGAL_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="text-xs text-foreground/60 transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
        <nav aria-label="Site" className="sr-only">
          {HIDDEN_FOOTER_LINKS.map((link) => (
            <Link key={link.to} to={link.to} tabIndex={-1}>
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  </>
);

export const Route = createFileRoute("/")({
  headers: varyHeaders,
  component: Page,
  server: { handlers: { GET: markdownHandler(homeMarkdown) } },
});
