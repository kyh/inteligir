"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@kyh/ui/button";
import { Logo } from "@kyh/ui/logo";
import { cn } from "@kyh/ui/utils";
import { useQuery } from "@tanstack/react-query";
import { useScroll } from "motion/react";

import { NavLink } from "@/components/nav";
import { useTRPC } from "@/trpc/react";

const baseContainerClassName = "sticky top-0 z-40 w-full bg-transparent";

export const Header = () => {
  const [containerClassName, setContainerClassName] = useState(
    baseContainerClassName,
  );
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.auth.workspace.queryOptions());

  const user = data?.user;
  const metaData = data?.userMetadata;

  const { scrollY } = useScroll();

  useEffect(() => {
    const subscription = scrollY.on("change", () => {
      if (scrollY.get() > 100) {
        setContainerClassName(cn(baseContainerClassName, "backdrop-blur"));
      } else {
        setContainerClassName(baseContainerClassName);
      }
    });
    return () => subscription();
  }, [scrollY]);

  return (
    <header className={containerClassName}>
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5">
        <div className="flex-1">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <nav className="flex flex-1 justify-center">
          <ul className="flex gap-3 md:gap-8">
            <li>
              <NavLink href="/">Home</NavLink>
            </li>
            <li>
              <NavLink href="/docs">Documentation</NavLink>
            </li>
            <li>
              <NavLink href="/pricing">Pricing</NavLink>
            </li>
          </ul>
        </nav>
        <div className="flex flex-1 justify-end">
          {isLoading ? (
            <span
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "ml-4 w-24 animate-pulse rounded-full px-5",
              )}
            />
          ) : user ? (
            <Link
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "ml-4 w-24 rounded-full px-5",
              )}
              href={`/dashboard/${metaData?.defaultTeamSlug}`}
            >
              Dashboard
            </Link>
          ) : (
            <Link
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "ml-4 w-24 rounded-full px-5",
              )}
              href="/auth/sign-in"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
