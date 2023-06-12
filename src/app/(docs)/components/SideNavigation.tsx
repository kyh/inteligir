"use client";

import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { NavLink } from "~/components/NavLink";

export const pages = [
  {
    title: "Guides",
    links: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "SDKs", href: "/docs/sdks" },
      { title: "Authentication", href: "/docs/authentication" },
      { title: "Errors", href: "/docs/errors" },
    ],
  },
  {
    title: "API",
    links: [
      { title: "Upload", href: "/docs/resource/upload" },
      { title: "Train", href: "/docs/resource/train" },
      { title: "Query", href: "/docs/resource/query" },
      { title: "Stats", href: "/docs/resource/stats" },
    ],
  },
];

export const SideNavigation = () => {
  const params = useParams() ?? {};
  const slug = (params.slug || "").toString();
  const activeLink = `/docs${slug ? `/${slug}` : ""}`;

  return (
    <div className="hidden lg:mt-10 lg:block">
      <nav>
        <ul className="flex flex-col gap-3">
          {pages.map((pageSection) => (
            <div key={pageSection.title}>
              <li>{pageSection.title}</li>
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
    </div>
  );
};
