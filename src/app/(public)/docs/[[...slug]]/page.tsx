"use client";

import Logo from "~/components/ui/Logo";
import Footer from "~/app/(public)/components/Footer";
import Head from "~/app/(public)/components/Head";
import Header from "~/app/(public)/components/Header";
import MDX from "~/app/(public)/components/mdx";
import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/cn";
import { sluggifyTitle } from "~/lib/contentUtils";
import type { DocHeading } from "contentlayer.config";
import { Doc, allDocs } from "contentlayer/generated";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { FC } from "react";
import { useState } from "react";

type NavTreeNode = {
  title: string | null;
  href: string | null;
  children: NavTreeNode[];
};

const constructTOC = (docs: Doc[], title: string | null): NavTreeNode => {
  const doc = docs[0];
  if (doc && docs.length === 1 && doc.pathSegments.length === 0) {
    return {
      title: title ?? doc.title,
      href: "/" + doc.url_path,
      children: [],
    };
  }

  const indexDoc = docs.find((d) => d.pathSegments.length === 0);
  const remainingDocs = docs.filter((d) => d.pathSegments.length > 0);

  const children = Array.from(
    remainingDocs
      .map((d) => d.pathSegments[0])
      .sort((a, b) => a.order - b.order)
      .reduce<string[]>((acc, cur) => {
        if (!acc.some((name) => name === cur.name)) {
          acc.push(cur.name);
        }
        return acc;
      }, [])
  );

  return {
    title: indexDoc?.title ?? title ?? "Untitled",
    href: indexDoc?.url_path ? "/" + indexDoc.url_path : null,
    children: children.map((c) => {
      const relevantDocs = remainingDocs
        .filter((d) => d.pathSegments[0].name === c)
        .map((d) => ({ ...d, pathSegments: d.pathSegments.slice(1) }));

      return constructTOC(relevantDocs, c.replaceAll("-", " "));
    }),
  };
};

type PathSegment = { order: number; name: string };

const PageContents: FC<{ headings: DocHeading[] }> = ({ headings }) => {
  const headingsToRender = headings.filter((h) => h.level > 1);

  if ((headingsToRender ?? []).length === 0) return null;

  return (
    <>
      <h4 className="mb-4 font-medium">On this page</h4>
      <ul className="space-y-2">
        {headingsToRender.map(({ title, level }, index) => {
          return (
            <li key={index}>
              <a
                href={`#${sluggifyTitle(title)}`}
                style={{ marginLeft: (level - 2) * 16 }}
                className={cn(
                  "flex text-gray-600 transition hover:text-gray-900"
                )}
              >
                {title}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
};

const DocsContents: React.FC<{
  node: NavTreeNode;
  level?: number;
  onNav?: () => void;
}> = ({ node, level = 0, onNav }) => {
  const pathname = usePathname();

  const hasChildren = node.children.length > 0;

  const row = (
    <p
      className={cn("rounded-md py-1 pl-4", {
        "mt-3": level === 1 && hasChildren,
        "mt-1": level > 1 && hasChildren,
        "font-medium": hasChildren,
        "transition hover:bg-gray-200": !!node.href,
        "cursor-default select-none": !node.href,
        "bg-gray-100": pathname === node.href,
      })}
    >
      {node.title}
    </p>
  );

  return (
    <>
      {node.href ? (
        <NextLink href={node.href} onClick={onNav}>
          {row}
        </NextLink>
      ) : (
        row
      )}
      <div
        className={cn({
          "ml-4": level > 0,
        })}
      >
        {node.children.map((child, index) => (
          <DocsContents
            level={level + 1}
            key={index}
            node={child}
            onNav={onNav}
          />
        ))}
      </div>
    </>
  );
};

const Doc = ({
  params,
}: {
  params: {
    slug: string[];
  };
}) => {
  const { slug } = params;
  const pagePath = (slug && slug.join("/")) ?? "";

  const doc = allDocs.find(
    (d) =>
      d.pathSegments.map((ps: PathSegment) => ps.name).join("/") === pagePath
  );

  if (!doc) {
    throw new Error(`No doc found for slug: ${slug}`);
  }

  const toc = constructTOC(allDocs, null);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="relative">
      <Head title={doc.title} description={doc.excerpt} image={""} />
      <div className="sticky top-0 z-10 flex w-full items-center border-b border-gray-200 bg-white">
        <Header fullWidth />
      </div>
      <div className="mx-auto flex max-w-[90rem]">
        {/* desktop nav tree */}
        <aside className="sticky top-20 hidden h-full shrink-0 overflow-auto px-4 py-5 md:block md:w-[320px]">
          <DocsContents node={toc} onNav={() => setMobileSidebarOpen(false)} />
        </aside>
        {/* mobile nav tree */}
        {mobileSidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 h-full w-full animate-fadeIn bg-gray-500 opacity-50 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-2/3 max-w-[320px] animate-slideRightAndFadeIn bg-white p-4 md:hidden">
              <Logo variant="wordmark" className="" />
              <div className="h-8" />
              <DocsContents
                node={toc}
                onNav={() => setMobileSidebarOpen(false)}
              />
            </div>
          </>
        )}
        <article
          className={cn(
            "relative flex h-full min-h-screen w-full justify-between overflow-auto px-4 pt-0 pb-20 md:px-8"
          )}
        >
          <div className="w-full">
            <MDX content={doc.body.code} />
          </div>
        </article>
        <nav className="sticky top-20 hidden h-full shrink-0 overflow-auto px-4 py-5 md:w-[280px] lg:block">
          <PageContents headings={doc.headings} />
        </nav>
      </div>
      <Separator />
      <Footer />
    </div>
  );
};

export default Doc;
