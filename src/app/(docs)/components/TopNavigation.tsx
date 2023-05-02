import { forwardRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion } from "framer-motion";
import { Button } from "~/components/Button";
import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import {
  MobileNavigation,
  useIsInsideMobileNavigation,
  useMobileNavigationStore,
} from "~/app/(docs)/components/MobileNavigation";

// import { MobileSearch, Search } from "~/app/(docs)/components/Search";

export const TopNavigation = forwardRef(function TopNavigation(
  { className }: { className?: string },
  ref: React.Ref<HTMLDivElement>
) {
  const { isOpen: mobileNavIsOpen } = useMobileNavigationStore();
  const isInsideMobileNavigation = useIsInsideMobileNavigation();

  return (
    <motion.div
      ref={ref}
      className={clsx(
        className,
        "fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between gap-12 px-4 transition sm:px-6 lg:z-30 lg:px-8",
        !isInsideMobileNavigation &&
          "backdrop-blur-sm dark:backdrop-blur lg:left-72 xl:left-80",
        isInsideMobileNavigation ? "bg-gray-900" : "bg-gray-900/20"
      )}
    >
      <div
        className={clsx(
          "absolute inset-x-0 top-full h-px transition",
          (isInsideMobileNavigation || !mobileNavIsOpen) &&
            "bg-gray-900/7.5 dark:bg-white/7.5"
        )}
      />
      {/* <Search /> */}
      <div className="hidden lg:block lg:max-w-md lg:flex-auto" />
      <div className="flex items-center gap-5 lg:hidden">
        <MobileNavigation />
        <Link href="/docs" aria-label="Documentation">
          <Logo />
        </Link>
      </div>
      <div className="flex items-center gap-5">
        <nav className="hidden md:block">
          <ul className="flex items-center gap-8">
            <li>
              <NavLink href="/">Home</NavLink>
            </li>
            <li>
              <NavLink href="/docs">Documentation</NavLink>
            </li>
            <li>
              <NavLink href="/support">Support</NavLink>
            </li>
          </ul>
        </nav>
        <div className="hidden md:block md:h-5 md:w-px md:bg-gray-900/10 md:dark:bg-white/15" />
        {/* <div className="flex gap-4">
          <MobileSearch />
        </div> */}
        <div className="hidden min-[416px]:contents">
          <Button size="sm">Sign in</Button>
        </div>
      </div>
    </motion.div>
  );
});
