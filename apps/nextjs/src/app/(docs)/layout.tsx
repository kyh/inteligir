import type { Metadata } from "next";
import { allDocs } from "@kyh/mdx/content";
import { Logo } from "@kyh/ui/logo";

import { NavLink } from "@/components/nav";

export const metadata: Metadata = {
  title: "Docs",
};

type LayoutProps = {
  children: React.ReactNode;
};

const Layout = (props: LayoutProps) => (
  <section className="flex min-h-dvh">
    <Sidebar />
    <main className="prose dark:prose-invert flex-1 px-10 py-16">
      {props.children}
    </main>
  </section>
);

export default Layout;

const Sidebar = () => {
  const docByGroup = allDocs.reduce(
    (acc, doc) => {
      const group = doc._meta.path.split("/")[0];
      if (!group) return acc;

      if (!acc[group]) {
        acc[group] = [];
      }

      acc[group].push(doc);
      return acc;
    },
    {} as Record<string, typeof allDocs>,
  );

  return (
    <aside className="border-border sticky top-0 max-h-dvh w-64 overflow-y-auto border-r">
      <div className="p-5">
        <NavLink href="/">
          <Logo className="size-10" />
        </NavLink>
      </div>
      <nav className="pb-5 text-sm">
        <ul className="space-y-4">
          {Object.entries(docByGroup).map(([group, docs]) => (
            <li key={group}>
              <h4 className="text-muted-foreground px-6 py-2 text-xs font-light capitalize">
                {group.replace(/-/g, " ")}
              </h4>
              <ul>
                {docs.map((doc) => (
                  <li key={doc._meta.fileName}>
                    <NavLink
                      href={`/docs/${doc._meta.path}`}
                      className="hover:text-muted-foreground block px-6 py-2 capitalize transition"
                      activeClassName="bg-muted hover:text-foreground"
                      exact
                    >
                      {doc._meta.fileName
                        .replace(/\.mdx$/, "")
                        .replace(/-/g, " ")}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li>
            <h4 className="text-muted-foreground px-6 py-2 text-xs font-light">
              Community
            </h4>
            <ul>
              {[
                {
                  id: "github",
                  href: "https://github.com/kyh/init",
                  label: "Github",
                },
                {
                  id: "twitter",
                  href: "https://twitter.com/kaiyuhsu",
                  label: "Twitter",
                },
                {
                  id: "discord",
                  href: "https://discord.gg/x2xDwExFFv",
                  label: "Discord",
                },
              ].map((link) => (
                <li key={link.id}>
                  <NavLink
                    href={link.href}
                    className="hover:text-muted-foreground block px-6 py-2 transition"
                    activeClassName="bg-muted hover:text-foreground"
                    exact
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        </ul>
      </nav>
    </aside>
  );
};
