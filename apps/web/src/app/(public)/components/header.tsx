"use client";

import { cn } from "@/lib/cn";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Session } from "@supabase/supabase-js";
import { buttonVariants } from "@/components/ui/button";

export function Header({ session }: { session?: Session | null }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="relatve fixed top-0 z-50 w-full overflow-hidden backdrop-blur-2xl">
      <div className="mx-auto flex max-w-6xl flex-col px-8 py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-row items-center justify-between text-white lg:justify-start">
          <Link href="/" className="inline-flex items-center gap-3">
            <Logo />
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center justify-center p-2 text-white hover:text-indigo-400 focus:text-white focus:outline-none md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
        <nav
          className={cn(
            open ? "flex" : "hidden",
            "flex-grow flex-col items-center md:flex md:flex-row md:justify-end md:pb-0"
          )}
        >
          <Link
            className="px-2 py-2 text-sm font-normal text-brand-300 transition hover:text-white md:px-3 lg:ml-auto lg:px-6"
            href="/docs"
          >
            Documentation
          </Link>
          <Link
            className="px-2 py-2 text-sm font-normal text-brand-300 transition hover:text-white md:px-3 lg:px-6"
            href="/blog"
          >
            Blog
          </Link>
          <Link
            href={session ? "/start" : "/login"}
            className={buttonVariants({
              variant: "secondary",
              size: "sm",
              className: "ml-2 md:ml-4",
            })}
          >
            {session ? "Dashboard" : "Login"}
          </Link>
        </nav>
      </div>
    </section>
  );
}
