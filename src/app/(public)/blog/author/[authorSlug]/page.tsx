import { Head } from "~/components/ui/head";
import PostCard from "~/app/(public)/blog/components/PostCard";
import { allAuthors, allPosts } from "contentlayer/generated";

export const revalidate = 60;

export default async function PostPage({
  params,
}: {
  params: { authorSlug: string };
}) {
  const { authorSlug } = params;

  const author = allAuthors.find((a) => a.slug === authorSlug);

  if (!author) throw new Error("Author not found");

  const posts = allPosts.filter((p) => p.author === author.slug);

  return (
    <>
      <Head
        title={author.name}
        description={`${author.name}'s posts for the Inteligir blog`}
        image="https://cdn.hashnode.com/res/hashnode/image/upload/v1678913555475/TFjT1bbJa.png"
      />
      <div className="container mx-auto mt-16 max-w-[920px] py-12">
        <h1 className="mb-10 text-xl font-medium">
          <span className="text-gray-500">More posts from </span>
          <span className="font-semibold">{author.name}</span>
        </h1>
        <ul className="grid grid-cols-1 gap-x-12 gap-y-16 lg:grid-cols-2 lg:gap-y-20">
          {posts.map((post) => (
            <li key={post.slug}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
