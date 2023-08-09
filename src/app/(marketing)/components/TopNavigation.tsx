"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useScroll } from "framer-motion";
import useSignOut from "~/core/hooks/use-sign-out";
import UserSession from "~/core/session/types/user-session";
import { cn } from "~/lib/utils";
import { If } from "~/components/If";
import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import ProfileDropdown from "~/components/ProfileDropdown";

const baseContainerClassName = "sticky top-0 z-40 w-full bg-transparent";

type TopNavigationProps = {
  userSession: Maybe<UserSession>;
};

export const TopNavigation = ({ userSession }: TopNavigationProps) => {
  const signOut = useSignOut();
  const [containerClassName, setContainerClassName] = useState(
    baseContainerClassName,
  );
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
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
        <Link href="/">
          <Logo />
        </Link>
        <nav>
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
        <If
          condition={userSession?.auth}
          fallback={
            <div className="space-x-2">
              <NavLink variant="primary" href="/auth/sign-in">
                Sign In
              </NavLink>
            </div>
          }
        >
          <ProfileDropdown
            userSession={userSession}
            signOutRequested={signOut}
          />
        </If>
      </div>
    </header>
  );
};
