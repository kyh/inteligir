import MDX from "@/app/(public)/components/mdx";
import { buttonVariants } from "ui/components/button";
import { allLegals } from "contentlayer/generated";
import { ArrowLeft } from "ui/icons";
import Link from "next/link";

export const revalidate = 60;

export default function PostPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const post = allLegals.find((p) => p.slug === slug);
  if (!post) {
    throw new Error(`Post with slug ${slug} not found`);
  }

  return (
    <>
      <div className="container mt-16 px-4 py-12">
        <Link href="/" className={buttonVariants({ variant: "transparent" })}>
          <ArrowLeft className="mr-1 w-4" /> Back Home
        </Link>
        <div className="mt-4 flex flex-col">
          <h1 className="mb-3 text-4xl font-bold">{post.title}</h1>
          <MDX content={post.body.code} />
        </div>
      </div>
    </>
  );
}
