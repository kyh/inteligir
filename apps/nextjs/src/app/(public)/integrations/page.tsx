import Image from "next/image";
import Link from "next/link";
import { allIntegrations } from "contentlayer/generated";

export const revalidate = 60;

const Page = () => {
  return (
    <div className="container mt-16 max-w-6xl lg:mt-16">
      <div className="mt-20 flex flex-col justify-between gap-4 md:mb-12 md:mt-28 md:flex-row md:items-center">
        <h1 className="text-4xl font-bold md:text-5xl">Integrations</h1>
      </div>
      <ul className="grid grid-cols-1 gap-x-12 gap-y-16 lg:grid-cols-2 lg:gap-y-20">
        {allIntegrations.map((post) => (
          <li key={post._id}>
            <Link
              className="flex h-full flex-col space-y-3"
              href={`/integrations/${post.slug}`}
            >
              {post.heroImage ? (
                <Image
                  alt={post.title}
                  className="mx-auto mb-2 rounded-md ring-0 ring-gray-200 transition-[ring] hover:ring-8 "
                  height={480}
                  src={post.heroImage}
                  width={640}
                />
              ) : null}
              <p className="text-2xl font-bold">{post.title}</p>
              <p className="h-full leading-relaxed text-gray-500">
                {post.brief}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Page;
