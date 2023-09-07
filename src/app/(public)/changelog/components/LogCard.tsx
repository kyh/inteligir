import Image from "next/image";
import type { Author, Log } from "contentlayer/generated";
import { AuthorCard } from "../../components/AuthorCard";
import PostDate from "../blog/PostDate";
import MDX from "../../components/mdx";
import { Separator } from "~/components/ui/separator";
import Link from "next/link";

export default function LogCard({
  log,
  author,
  link,
  showSeparator = true,
}: {
  log: Log;
  author: Author;
  link?: boolean;
  showSeparator?: boolean;
}) {
  const hero = (
    <>
      <Image
        src={log.heroImage}
        alt={log.title}
        className="w-full rounded-md"
        width={920}
        height={640}
      />
      <h2 className="mt-5 mb-4 text-4xl font-extrabold">{log.title}</h2>
    </>
  );
  return (
    <li
      key={log._id}
      className="relative grid grid-cols-3 md:grid-cols-4 md:pb-16"
    >
      <div className="sticky top-24 col-span-1 hidden h-fit pb-5 text-base md:block">
        <PostDate timeString={log.createdAt} />
      </div>
      <div className="col-span-3">
        <div className="relative w-full md:pl-8">
          {link ? <Link href={`/changelog/${log.slug}`}>{hero}</Link> : hero}
          <PostDate timeString={log.createdAt} className="mt-4 md:hidden" />
          <AuthorCard author={author} link={false} />
          <MDX content={log.body.code} />
        </div>
      </div>
      {showSeparator && (
        <Separator className="col-span-4 my-8 w-full md:mt-20" />
      )}
    </li>
  );
}
