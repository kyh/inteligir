"use client";

import { clx, Logo, Button } from "@inteligir/ui";
import { BarsThree } from "@inteligir/icons";
import Link from "next/link";
import { useState } from "react";
import type { Session } from "@supabase/supabase-js";

export const Header = ({ session }: { session?: Session | null }) => {
  const [open, setOpen] = useState(false);

  return (
    <section className="relatve fixed top-0 z-50 w-full overflow-hidden backdrop-blur-2xl">
      <div className="container flex max-w-6xl flex-col py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-row items-center justify-between text-ui-fg-base lg:justify-start">
          <Link className="inline-flex items-center gap-3" href="/">
            <Logo />
          </Link>
          <button
            className="inline-flex items-center justify-center p-2 text-ui-fg-base hover:text-indigo-400 focus:text-ui-fg-base focus:outline-none md:hidden"
            onClick={() => {
              setOpen(!open);
            }}
          >
            <BarsThree className="h-6 w-6" />
          </button>
        </div>
        <nav
          className={clx(
            open ? "flex" : "hidden",
            "flex-grow flex-col items-center md:flex md:flex-row md:justify-end md:pb-0",
          )}
        >
          <Link
            className="px-2 py-2 text-sm font-normal text-ui-fg-subtle transition hover:text-ui-fg-base md:px-5 lg:ml-auto"
            href="/examples"
          >
            Examples
          </Link>
          <Link
            className="px-2 py-2 text-sm font-normal text-ui-fg-subtle transition hover:text-ui-fg-base md:px-5"
            href="/integrations"
          >
            Integrations
          </Link>
          <Button asChild className="ml-2 md:ml-4" variant="secondary">
            <Link href={session ? "/start" : "/login"}>
              {session ? "Dashboard" : "Login"}
            </Link>
          </Button>
        </nav>
      </div>
    </section>
  );
};
