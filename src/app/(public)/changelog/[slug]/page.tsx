import BackTo from "~/components/home/BackToBlog";
import Footer from "~/components/home/Footer";
import Head from "~/components/home/Head";
import { BlogHeader } from "~/components/home/Header";
import LogCard from "~/app/(public)/changelog/components/LogCard";
import { Separator } from "~/components/ui/separator";
import { allAuthors, allLogs } from "contentlayer/generated";

export default function LogPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  const log = allLogs.find((p) => p.slug === slug);
  if (!log) {
    throw new Error(`Log with slug ${slug} not found`);
  }

  const author = allAuthors.find((a) => a.slug === log.author);
  if (!author) {
    throw new Error(`Author with slug ${log.author} not found`);
  }

  return (
    <>
      <Head title={log.title} description={""} image={log.heroImage} />
      <div className="">
        <BlogHeader />
        <div className="relative mx-auto mt-8 max-w-7xl py-12 px-4">
          <BackTo location="changelog" />
          <Separator className="mt-4 mb-8" />
          <div className="flex flex-col">
            <LogCard log={log} author={author} />
            <div className="h-8" />
            <Footer />
          </div>
        </div>
      </div>
    </>
  );
}
