import { Head } from "~/components/ui/head";
import PostCard from "./components/PostCard";
import { Separator } from "~/components/ui/separator";
import { Author, Post, allAuthors, allPosts } from "contentlayer/generated";

export const revalidate = 60;

export default async function Home() {
  const posts = allPosts
    .map((p) => ({
      ...p,
      author: allAuthors.find((a) => a.slug === p.author),
    }))
    .filter((p) => p.author !== undefined) as (Post & { author: Author })[];

  return (
    <>
      <Head
        title="Inteligir Blog"
        description="Learn how to make production ready web apps with Inteligir"
        image="https://cdn.hashnode.com/res/hashnode/image/upload/v1678913555475/TFjT1bbJa.png"
      />
      <div className="container mx-auto mt-16 max-w-7xl px-4 lg:mt-16">
        <div className="mt-20 flex flex-col justify-between gap-4 md:mt-28 md:mb-12 md:flex-row md:items-center">
          <h1 className="text-4xl font-bold md:text-5xl">Blog</h1>
        </div>
        <Separator className="my-4 md:my-12" />
        <ul className="grid grid-cols-1 gap-x-12 gap-y-16 lg:grid-cols-2 lg:gap-y-20">
          {posts.map((post) => (
            <li key={post._id}>
              <PostCard post={post} author={post.author} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
