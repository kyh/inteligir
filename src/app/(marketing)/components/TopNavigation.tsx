"use client";

import Link from "next/link";
import { useScroll } from "framer-motion";
import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import clsx from "clsx";
import { useEffect, useState } from "react";
import If from "~/core/ui/If";
import ProfileDropdown from "~/components/ProfileDropdown";
import useSignOut from "~/core/hooks/use-sign-out";
import useUserSession from "~/core/hooks/use-user-session";
import configuration from "~/configuration";

const baseContainerClassName = "sticky top-0 z-40 w-full bg-transparent";

export const TopNavigation = () => {
  const signOut = useSignOut();
  const userSession = useUserSession();
  const [containerClassName, setContainerClassName] = useState(
    baseContainerClassName
  );
  const { scrollY } = useScroll();

  useEffect(() => {
    const subscription = scrollY.on("change", () => {
      if (scrollY.get() > 100) {
        setContainerClassName(clsx(baseContainerClassName, "backdrop-blur"));
      } else {
        setContainerClassName(baseContainerClassName);
      }
    });
    return () => subscription();
  }, [scrollY]);

  return (
    <div className={containerClassName}>
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
        <If condition={userSession?.auth} fallback={<AuthButtons />}>
          <ProfileDropdown
            userSession={userSession}
            signOutRequested={signOut}
          />
        </If>
      </div>
    </div>
  );
};

function AuthButtons() {
  return (
    <div className="space-x-2">
      <Link className="text-sm text-white" href={configuration.paths.signIn}>
        Sign In
      </Link>
    </div>
  );
}
