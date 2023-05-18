"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";
import { remToPx } from "~/lib/utils/remToPx";
import Button from "~/components/Button";
import { Tag } from "~/components/Tag";
import { useIsInsideMobileNavigation } from "~/app/(docs)/components/MobileNavigation";
import { useSectionStore } from "~/app/(docs)/components/SectionProvider";

function useInitialValue(value, condition = true) {
  const initialValue = useRef(value).current;
  return condition ? initialValue : value;
}

function TopLevelNavItem({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li className="md:hidden">
      <Link
        href={href}
        className="block py-1 text-sm text-zinc-400 transition hover:text-white"
      >
        {children}
      </Link>
    </li>
  );
}

function NavLink({
  href,
  tag,
  active,
  isAnchorLink = false,
  children,
}: {
  href: string;
  tag?: string;
  active?: boolean;
  isAnchorLink?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex justify-between gap-2 py-1 pr-3 text-sm transition",
        isAnchorLink ? "pl-7" : "pl-4",
        active
          ? "text-zinc-900 dark:text-white"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      )}
    >
      <span className="truncate">{children}</span>
      {tag && (
        <Tag variant="small" color="gray">
          {tag}
        </Tag>
      )}
    </Link>
  );
}

function VisibleSectionHighlight({ group, pathname }) {
  const [sections, visibleSections] = useInitialValue(
    [
      useSectionStore((s) => s.sections),
      useSectionStore((s) => s.visibleSections),
    ],
    useIsInsideMobileNavigation()
  );

  const isPresent = useIsPresent();
  const firstVisibleSectionIndex = Math.max(
    0,
    [{ id: "_top" }, ...sections].findIndex(
      (section) => section.id === visibleSections[0]
    )
  );
  const itemHeight = remToPx("2");
  const height = isPresent
    ? Math.max(1, visibleSections.length) * itemHeight
    : itemHeight;
  const top =
    group.links.findIndex((link) => link.href === pathname) * itemHeight +
    firstVisibleSectionIndex * itemHeight;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.2 } }}
      exit={{ opacity: 0 }}
      className="absolute inset-x-0 top-0 bg-gray-800/2.5 will-change-transform dark:bg-white/2.5"
      style={{ borderRadius: 8, height, top }}
    />
  );
}

function ActivePageMarker({ group, pathname }) {
  const itemHeight = remToPx("2");
  const offset = remToPx("0.4");
  const activePageIndex = group.links.findIndex(
    (link) => link.href === pathname
  );
  const top = offset + activePageIndex * itemHeight;

  return (
    <motion.div
      layout
      className="absolute left-2 h-4 w-px bg-emerald-500 shadow shadow-emerald-400"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.2 } }}
      exit={{ opacity: 0 }}
      style={{ top }}
    />
  );
}

function NavigationGroup({ group, className }) {
  // If this is the mobile navigation then we always render the initial
  // state, so that the state does not change during the close animation.
  // The state will still update when we re-open (re-render) the navigation.
  const isInsideMobileNavigation = useIsInsideMobileNavigation();
  const [pathName, sections] = useInitialValue(
    [usePathname(), useSectionStore((s) => s.sections)],
    isInsideMobileNavigation
  );

  const isActiveGroup =
    group.links.findIndex((link) => link.href === pathName) !== -1;

  return (
    <li className={clsx("relative mt-6", className)}>
      <motion.h2
        layout="position"
        className="text-xs font-medium uppercase tracking-wide text-white"
      >
        {group.title}
      </motion.h2>
      <div className="relative mt-3 pl-2">
        <AnimatePresence initial={!isInsideMobileNavigation}>
          {isActiveGroup && (
            <VisibleSectionHighlight group={group} pathname={pathName} />
          )}
        </AnimatePresence>
        <motion.div
          layout
          className="absolute inset-y-0 left-2 w-px bg-gray-900/10 dark:bg-white/5"
        />
        <AnimatePresence initial={false}>
          {isActiveGroup && (
            <ActivePageMarker group={group} pathname={pathName} />
          )}
        </AnimatePresence>
        <ul className="border-l border-transparent">
          {group.links.map((link) => (
            <motion.li key={link.href} layout="position" className="relative">
              <NavLink href={link.href} active={link.href === pathName}>
                {link.title}
              </NavLink>
              <AnimatePresence mode="popLayout" initial={false}>
                {link.href === pathName && sections.length > 0 && (
                  <motion.ul
                    role="list"
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: 1,
                      transition: { delay: 0.1 },
                    }}
                    exit={{
                      opacity: 0,
                      transition: { duration: 0.15 },
                    }}
                  >
                    {sections.map((section) => (
                      <li key={section.id}>
                        <NavLink
                          href={`${link.href}#${section.id}`}
                          tag={section.tag}
                          isAnchorLink
                        >
                          {section.title}
                        </NavLink>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </motion.li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export const navigation = [
  {
    title: "Guides",
    links: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "SDKs", href: "/docs/sdks" },
      { title: "Authentication", href: "/docs/authentication" },
      { title: "Cache", href: "/docs/cache" },
      { title: "Errors", href: "/docs/errors" },
    ],
  },
  {
    title: "Resources",
    links: [
      { title: "Cache", href: "/docs/resource/cache" },
      { title: "Clients", href: "/docs/resource/clients" },
      { title: "Activity", href: "/docs/resource/activity" },
      { title: "Stats", href: "/docs/resource/stats" },
    ],
  },
];

export function SideNavigation(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <nav {...props}>
      <ul>
        <TopLevelNavItem href="/">Home</TopLevelNavItem>
        <TopLevelNavItem href="/docs">Documentation</TopLevelNavItem>
        <TopLevelNavItem href="/support">Support</TopLevelNavItem>
        {navigation.map((group, groupIndex) => (
          <NavigationGroup
            key={group.title}
            group={group}
            className={groupIndex === 0 && "md:mt-0"}
          />
        ))}
        <li className="sticky bottom-0 z-10 mt-6 min-[416px]:hidden">
          <Button className="w-full">Sign in</Button>
        </li>
      </ul>
    </nav>
  );
}
