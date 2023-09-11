import Footer from "~/components/home/Footer";
import Head from "~/components/home/Head";
import { BlogHeader as HomeHeader } from "~/components/home/Header";
import PageTitle from "~/components/home/PageTitle";
import LogCard from "~/app/(public)/changelog/components/LogCard";
import { Separator } from "~/components/ui/separator";
import type { Author, Log } from "contentlayer/generated";
import { allAuthors, allLogs } from "contentlayer/generated";

export const revalidate = 60;

export default function ChangelogHome() {
  const logs = allLogs
    .map((l) => {
      return {
        ...l,
        author: allAuthors.find((a) => a.slug === l.author),
      };
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ) as (Log & { author: Author })[];

  return (
    <>
      <Head
        title="Inteligir Changelog"
        description="The latest features, improvements, and bug fixes for Inteligir"
        image="https://cdn.hashnode.com/res/hashnode/image/upload/v1678913555475/TFjT1bbJa.png"
      />
      <div className="">
        <HomeHeader />
        <div className="container mx-auto mt-16 max-w-7xl px-4 lg:mt-16">
          <PageTitle>Changelog</PageTitle>
          <Separator className="my-4 md:my-12" />
          <ul className="flex flex-col">
            {logs.map((log, i) => (
              <LogCard
                key={log.slug}
                log={log}
                author={log.author}
                link
                showSeparator={i !== logs.length - 1}
              />
            ))}
          </ul>
        </div>
        <Footer className="" />
      </div>
    </>
  );
}
