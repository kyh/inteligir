"use client";

import { AuthorCard } from "~/app/(public)/components/AuthorCard";
import BackTo from "~/app/(public)/components/BackToBlog";
import Footer from "~/app/(public)/components/Footer";
import Head from "~/app/(public)/components/Head";
import { BlogHeader } from "~/app/(public)/components/Header";
import TimeToRead from "../components/MinuteRead";
import PostDate from "../components/PostDate";
import MDX from "~/app/(public)/components/mdx";
import { Button } from "~/components/ui/button";
import { DEMO_LINK } from "~/lib/links";
import { allAuthors, allPosts } from "contentlayer/generated";
import { ArrowRight } from "lucide-react";
import Image from "next/image";

export const revalidate = 60;

export default function PostPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const post = allPosts.find((p) => p.slug === slug);
  if (!post) {
    throw new Error(`Post with slug ${slug} not found`);
  }

  const author = allAuthors.find((a) => a.slug === post.author);
  if (!author) {
    throw new Error(`Author with slug ${post.author} not found`);
  }

  return (
    <>
      <Head
        title={post.title}
        description={post.brief}
        image={post.heroImage}
      />
      <div className="">
        <BlogHeader />
        <div className="container relative mx-auto mt-16 max-w-[820px] py-12 px-4">
          <BackTo location="blog" />
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
            <div className="my-4 w-full rounded py-10 px-4 pt-12 text-center shadow-outline">
              <h3 className="text-xl font-bold md:text-2xl">
                Scalerepo is a production-ready SaaS boilerplate
              </h3>
              <p className="mt-4 mb-6 text-base">
                Skip the tedious parts of building auth, org management,
                payments, and emails
              </p>
              <Button asChild>
                <a href={DEMO_LINK}>See the demo</a>
                <ArrowRight className="ml-2 w-4" />
              </Button>
            </div>
            <div className="h-8" />
          </div>
        </div>
        <Footer />
      </div>
    </>
  );
}
