import { Head } from "ui/components/head";
import MDX from "@/app/(public)/components/mdx";
import { buttonVariants } from "ui/components/button";
import { allTemplates } from "contentlayer/generated";
import { ArrowLeft } from "ui/icons";
import Link from "next/link";
import Image from "next/image";

export const revalidate = 60;

export default function PostPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const post = allTemplates.find((p) => p.slug === slug);
  if (!post) {
    throw new Error(`Post with slug ${slug} not found`);
  }

  return (
    <>
      <Head
        title={post.title}
        description={post.brief}
        image={post.heroImage}
      />
      <div className="container mt-16 px-4 py-12">
        <Link
          href="/examples"
          className={buttonVariants({ variant: "transparent" })}
        >
          <ArrowLeft className="mr-1 w-4" /> Back to Templates
        </Link>
        <div className="mt-4 flex flex-col">
          {post.heroImage && (
            <Image
              className="mx-auto mb-8 rounded-md"
              src={post.heroImage}
              alt={post.title}
              width={920}
              height={640}
            />
          )}
          <h1 className="mb-3 text-4xl font-bold">{post.title}</h1>
          <MDX content={post.body.code} />
        </div>
      </div>
    </>
  );
}
