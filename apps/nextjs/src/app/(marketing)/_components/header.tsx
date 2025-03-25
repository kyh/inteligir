"use client";

import Link from "next/link";
import { buttonVariants } from "@init/ui/button";
import { Logo } from "@init/ui/logo";
import { cn } from "@init/ui/utils";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/react";

export const Header = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.auth.workspace.queryOptions());

  const user = data?.user;
  const metaData = data?.userMetadata;

  return (
    <div className="mx-auto w-full justify-center">
      <div className="border-t-none border-border mx-auto flex w-full max-w-7xl items-center justify-between border px-8 py-4 md:p-8">
        <div className="text-secondary-foreground flex items-center justify-between">
          <Link className="-ml-2" href="/">
            <Logo className="size-10" />
          </Link>
        </div>
        <nav className="ml-auto flex items-center text-sm">
          <Link
            className="text-muted-foreground hover:text-secondary-foreground px-4 py-2 transition"
            href="/docs"
          >
            Documentation
          </Link>
          <Link
            className="text-muted-foreground hover:text-secondary-foreground px-4 py-2 transition"
            href="https://github.com/kyh/init"
            target="_blank"
          >
            Github
          </Link>
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
        </nav>
      </div>
    </div>
  );
};
