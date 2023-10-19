import { Button } from "@inteligir/ui";
import { ArrowLeft } from "@inteligir/icons";
import Link from "next/link";
import Image from "next/image";
import { allTemplates } from "contentlayer/generated";
import MDX from "@/app/(public)/components/mdx";

export const revalidate = 60;

const Page = ({ params }: { params: { slug: string } }) => {
  const { slug } = params;

  const post = allTemplates.find((p) => p.slug === slug);
  if (!post) {
    throw new Error(`Post with slug ${slug} not found`);
  }

  return (
    <div className="container mt-16 px-4 py-12">
      <Button asChild variant="transparent">
        <Link href="/examples">
          <ArrowLeft className="mr-1 w-4" /> Back to Templates
        </Link>
      </Button>
      <div className="mt-4 flex flex-col">
        {post.heroImage ? (
          <Image
            alt={post.title}
            className="mx-auto mb-8 rounded-md"
            height={640}
            src={post.heroImage}
            width={920}
          />
        ) : null}
        <h1 className="mb-3 text-4xl font-bold">{post.title}</h1>
        <MDX content={post.body.code} />
      </div>
    </div>
  );
};

export default Page;
