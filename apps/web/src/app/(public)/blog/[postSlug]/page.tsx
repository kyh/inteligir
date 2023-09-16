import { AuthorCard } from "../components/AuthorCard";
import { Head } from "@/components/ui/head";
import TimeToRead from "../components/MinuteRead";
import PostDate from "../components/PostDate";
import MDX from "@/app/(public)/components/mdx";
import { Button } from "@/components/ui/button";
import { allAuthors, allPosts } from "contentlayer/generated";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export const revalidate = 60;

export default function PostPage({ params }: { params: { postSlug: string } }) {
  const { postSlug } = params;

  const post = allPosts.find((p) => p.slug === postSlug);
  if (!post) {
    throw new Error(`Post with postSlug ${postSlug} not found`);
  }

  const author = allAuthors.find((a) => a.slug === post.author);
  if (!author) {
    throw new Error(`Author with postSlug ${post.author} not found`);
  }

  return (
    <>
      <Head
        title={post.title}
        description={post.brief}
        image={post.heroImage}
      />
      <div className="container relative mx-auto mt-16 max-w-[820px] px-4 py-12">
        <Link href="/blog">
          <Button variant="link" className="px-0 text-gray-600 hover:underline">
            <ArrowLeft className="mr-2 w-4" /> Back to blog
          </Button>
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
          <div className="my-4 flex items-center text-base">
            <PostDate timeString={post.createdAt} />
            <span className="px-2 text-gray-200">•</span>
            <TimeToRead minutes={post.readTimeInMinutes} />
          </div>
          <h1 className="mb-3 text-4xl font-bold">{post.title}</h1>
          <AuthorCard author={author} />
          <MDX content={post.body.code} />
        </div>
      </div>
    </>
  );
}
