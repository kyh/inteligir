import Image from "next/image";
import Link from "next/link";
import type { Author } from "contentlayer/generated";
import { cn } from "ui/lib/cn";

export function AuthorCard({
  author,
  link = true,
}: {
  author: Author;
  link?: boolean;
}) {
  const body = (
    <div className="group mt-4 flex items-center space-x-2">
      <div className="relative h-[30px] w-[30px]">
        <Image
          className="rounded-full"
          src={author.image}
          alt={author.name}
          fill
          style={{ objectFit: "cover" }}
        />
      </div>
      <h2
        className={cn("text-base font-medium", {
          "group-hover:underline": link,
        })}
      >
        {author.name}
      </h2>
    </div>
  );

  if (!link) {
    return body;
  }

  return <Link href={`/blog/author/${author.slug}`}>{body}</Link>;
}
