import { cn } from "~/lib/cn";
import { DISCORD_LINK } from "~/lib/links";
import Link from "next/link";
import type { PropsWithChildren } from "react";
import Logo from "~/components/ui/Logo";
import { Section } from "./Section";

const Subsection: React.FC<PropsWithChildren<{ title: string }>> = ({
  title,
  children,
}) => (
  <div className="flex flex-col space-y-3 p-2">
    <p className="text-sm font-bold">{title}</p>
    <div className="flex flex-col space-y-3 text-gray-500">{children}</div>
  </div>
);

export default function Footer({ className }: { className?: string }) {
  return (
    <div className={cn("border-t bg-gray-100", className)}>
      <Section>
        <div className="flex min-h-[200px] flex-col justify-between gap-8 bg-gray-100 text-base md:flex-row">
          <div className="flex h-full shrink-0 flex-col">
            <Logo variant="wordmark" />
            <p className="mt-3 max-w-sm text-gray-600">
              Demo app of Scalerepo, a production-ready starter kit built with
              Next.js and Planetscale.
            </p>
            <p className="mt-12 text-gray-400">© 2023 Demorepo</p>
          </div>
          <div className="flex flex-wrap justify-between gap-x-24 px-2">
            <Subsection title="Product">
              <Link href="/changelog">Changelog</Link>
              <Link href="/docs">Docs</Link>
            </Subsection>
            <Subsection title="Company">
              <Link href="/blog">Blog</Link>
              <Link href="/">About us</Link>
              <Link href="/">Terms</Link>
              <Link href="/">Privacy</Link>
            </Subsection>
            <Subsection title="Social">
              <Link href={DISCORD_LINK}>Discord</Link>
              <Link href="/">Twitter</Link>
              <Link href="/">GitHub</Link>
            </Subsection>
          </div>
        </div>
      </Section>
    </div>
  );
}
