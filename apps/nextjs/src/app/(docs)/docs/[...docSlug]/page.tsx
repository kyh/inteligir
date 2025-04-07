import { notFound } from "next/navigation";
import { MDXContent } from "@kyh/mdx";
import { allDocs } from "@kyh/mdx/content";

type PageProps = {
  params: Promise<{
    docSlug: string[];
  }>;
};

const Page = async ({ params }: PageProps) => {
  const { docSlug } = await params;

  const currentDoc = allDocs.find((doc) => {
    return doc._meta.filePath.replace(/\.mdx$/, "") === docSlug.join("/");
  });

  if (!currentDoc) {
    return notFound();
  }

  return <MDXContent code={currentDoc.mdx} />;
};

export default Page;
