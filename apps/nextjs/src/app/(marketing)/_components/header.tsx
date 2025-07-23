"use client";

import Link from "next/link";
import { buttonVariants } from "@repo/ui/button";
import { Logo } from "@repo/ui/logo";
import { cn } from "@repo/ui/utils";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/react";

export const Header = () => {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.auth.workspace.queryOptions());

  const user = data?.user;
  const metaData = data?.userMetadata;

  return (
    <header className="flex items-center justify-between pt-16">
      <Link href="/">
        <Logo />
      </Link>
      <div className="flex flex-1 justify-end">
        {isLoading ? (
          <span
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "pointer-events-none w-16 animate-pulse",
            )}
          />
        ) : user ? (
          <Link
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "w-20",
            )}
            href={`/dashboard/${metaData?.defaultTeamSlug}`}
          >
            Dashboard
          </Link>
        ) : (
          <Link
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "w-16",
            )}
            href="/auth/sign-in"
          >
            Login
          </Link>
        )}
      </div>
    </header>
  );
};
