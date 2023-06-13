"use client";

import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import { Text } from "~/components/Text";

export const pages = [
  {
    title: "Guides",
    links: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "Integrations", href: "/docs/integrations" },
      { title: "SDKs", href: "/docs/sdks" },
    ],
  },
  {
    title: "API Reference",
    links: [
      { title: "Authentication", href: "/docs/api/authentication" },
      { title: "Upload", href: "/docs/api/upload" },
      { title: "Train", href: "/docs/api/train" },
      { title: "Query", href: "/docs/api/query" },
      { title: "Stats", href: "/docs/api/stats" },
    ],
  },
];

export const SideNavigation = () => {
  return (
    <div className="hidden lg:block">
      <Logo />
      <Nav className="mt-10" />
    </div>
  );
};

export const Nav = ({ className }: { className?: string }) => {
  const params = useParams() ?? {};
  const slug = (params.slug || "").toString();
  const activeLink = `/docs${slug ? `/${slug}` : ""}`;

  return (
    <nav className={className}>
      <ul className="flex flex-col gap-5">
        {pages.map((pageSection) => (
          <div key={pageSection.title}>
            <Text as="li" variant="label">
              {pageSection.title}
            </Text>
            <ul className="mt-3 pl-2">
              {pageSection.links.map((page) => (
                <li
                  key={page.href}
                  className="relative border-l border-border pl-4"
                >
                  {page.href === activeLink && (
                    <motion.div
                      layoutId="docs-sidebar-active"
                      className="absolute -left-px top-2 h-4 w-px bg-emerald-500 shadow shadow-emerald-400"
                    />
                  )}
                  <NavLink href={page.href}>{page.title}</NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </ul>
    </nav>
  );
};
