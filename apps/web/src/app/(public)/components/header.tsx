"use client";

import { useState } from "react";
import Link from "next/link";

import { BarsThree } from "@inteligir/icons";
import { Button, clx, Logo } from "@inteligir/ui";

export const Header = ({ session }: { session?: any | null }) => {
  const [open, setOpen] = useState(false);

  return (
    <section className="relatve fixed top-0 z-50 w-full overflow-hidden backdrop-blur-2xl">
      <div className="container flex max-w-6xl flex-col py-5 md:flex-row md:items-center md:justify-between">
        <div className="text-ui-fg-base flex flex-row items-center justify-between lg:justify-start">
          <Link className="inline-flex items-center gap-3" href="/">
            <Logo />
          </Link>
          <button
            className="text-ui-fg-base focus:text-ui-fg-base inline-flex items-center justify-center p-2 hover:text-indigo-400 focus:outline-none md:hidden"
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
            className="text-ui-fg-subtle hover:text-ui-fg-base px-2 py-2 text-sm font-normal transition md:px-5 lg:ml-auto"
            href="/examples"
          >
            Examples
          </Link>
          <Link
            className="text-ui-fg-subtle hover:text-ui-fg-base px-2 py-2 text-sm font-normal transition md:px-5"
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
