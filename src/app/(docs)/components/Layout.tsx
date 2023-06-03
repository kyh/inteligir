"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Logo } from "~/components/Logo";
import { Footer } from "./Footer";
import { Prose } from "./Prose";
import { SectionProvider, type SectionsType } from "./SectionProvider";
import { SideNavigation } from "./SideNavigation";
import { TopNavigation } from "./TopNavigation";

type LayoutProps = {
  children: React.ReactNode;
  sections?: SectionsType;
};

export function Layout({ children, sections = [] }: LayoutProps) {
  return (
    <SectionProvider sections={sections}>
      <div className="lg:ml-72 xl:ml-80">
        <motion.header
          layoutScroll
          className="fixed inset-y-0 left-0 z-40 contents w-72 overflow-y-auto border-r border-zinc-900/10 px-6 pb-8 pt-4 dark:border-white/10 lg:block xl:w-80"
        >
          <div className="hidden lg:flex">
            <Link href="/docs" aria-label="Documentation">
              <Logo />
            </Link>
          </div>
          <TopNavigation />
          <SideNavigation className="hidden lg:mt-10 lg:block" />
        </motion.header>
        <div className="relative min-h-screen px-4 pt-16 sm:px-6 lg:px-8">
          <main className="py-16">
            <Prose as="article">{children}</Prose>
          </main>
          <Footer />
        </div>
      </div>
    </SectionProvider>
  );
}
