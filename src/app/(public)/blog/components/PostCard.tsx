import type { Author, Post } from "contentlayer/generated";
import Image from "next/image";
import Link from "next/link";
import TimeToRead from "./MinuteRead";
import PostDate from "./PostDate";

export default function PostCard({
  post,
  author,
}: {
  post: Post;
  author?: Author;
}) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="flex h-full flex-col space-y-3"
    >
      {post.heroImage && (
        <Image
          className="mx-auto mb-2 rounded-md ring-0 ring-gray-200 transition-[ring] hover:ring-8 "
          src={post.heroImage}
          alt={post.title}
          width={640}
          height={480}
        />
      )}
      <p className="text-2xl font-bold">{post.title}</p>
      <p className="h-full leading-relaxed text-gray-500">{post.brief}</p>
      <div className="flex items-center justify-between">
        {author && (
          <span className="text-gray-500">
            {author.name} <span className="text-gray-200">|</span>{" "}
            <PostDate timeString={post.createdAt} className="font-primary" />
          </span>
        )}
        <TimeToRead minutes={post.readTimeInMinutes} />
      </div>
    </Link>
  );
}
