"use client";

import { cn } from "~/lib/cn";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "~/components/ui/logo";
import { Session } from "@supabase/supabase-js";

export function Header({ session }: { session?: Session | null }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="fixed z-50 w-full overflow-hidden relatve backdrop-blur-2xl top-0">
      <div className="mx-auto max-w-6xl py-5 px-8 flex flex-col md:items-center md:justify-between md:flex-row">
        <div className="flex flex-row items-center justify-between text-white lg:justify-start">
          <Link href="/" className="inline-flex items-center gap-3">
            <Logo />
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center justify-center p-2 text-white hover:text-indigo-400 focus:outline-none focus:text-white md:hidden"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>
        <nav
          className={cn(
            open ? "flex" : "hidden",
            "flex-col items-center flex-grow md:pb-0 md:flex md:justify-end md:flex-row"
          )}
        >
          <Link
            className="px-2 py-2 text-sm font-normal text-brand-300 lg:px-6 md:px-3 hover:text-white lg:ml-auto"
            href="/docs"
          >
            Documentation
          </Link>
          <Link
            className="px-2 py-2 text-sm font-normal text-brand-300 lg:px-6 md:px-3 hover:text-white"
            href="/blog"
          >
            Blog
          </Link>
          {session ? (
            <Link
              className="rounded-lg px-4 py-2 text-sm transition-all flex items-center justify-center text-white bg-gradient-to-b from-white/[.105] to-white/[.15] hover:to-white/[.25] h-8 ring-1 ring-inset ring-white/10"
              href="/start"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              className="px-2 py-2 text-sm font-normal text-brand-300 lg:px-6 md:px-3 hover:text-white"
              href="/login"
            >
              Login
            </Link>
          )}
        </nav>
      </div>
    </section>
  );
}
