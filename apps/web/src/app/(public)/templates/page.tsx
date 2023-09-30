import { Head } from "ui/components/head";
import Link from "next/link";
import { allTemplates, type Template } from "contentlayer/generated";

export const revalidate = 60;

const Page = async () => {
  return (
    <>
      <Head
        title="Inteligir Templates"
        description="Learn how to make production ready web apps with Inteligir"
        image="https://cdn.hashnode.com/res/hashnode/image/upload/v1678913555475/TFjT1bbJa.png"
      />
      <section className="container max-w-6xl pt-24 lg:pt-56">
        <div>
          <h1 className="bg-gradient-to-r from-slate-50 via-slate-300 to-slate-600 bg-clip-text pb-2 font-display text-4xl font-normal tracking-tight text-transparent sm:text-6xl">
            Unleash your potential
            <span className="lg:block"> through seamless online learning</span>
          </h1>
          <p className="mt-4 max-w-xl text-slate-300">
            Discover a boundless realm of knowledge and personal growth, all
            conclaiently accessible right at your fingertips
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-4">
          <div className="flex flex-wrap items-center">
            <div>
              <label className="sr-only" htmlFor="search">
                Quick search
              </label>
              <div className="relative flex items-center">
                <input
                  className="bg-card lock h-10 w-full appearance-none rounded-lg border-transparent px-4 py-2 pr-14 text-white placeholder-slate-300 ring-1 ring-inset ring-white/10 duration-200 focus:border-slate-300 focus:outline-none focus:ring-slate-300 sm:text-sm"
                  id="search"
                  name="search"
                  type="text"
                />
                <div className="absolute inset-y-0 right-0 flex py-1.5 pr-1.5">
                  <kbd className="inline-flex items-center rounded border-slate-200 px-0.5 font-sans text-xs text-white">
                    ⌘K
                  </kbd>
                </div>
              </div>
            </div>
          </div>
          <ol
            role="list"
            className="flex flex-wrap items-center gap-3 lg:col-span-3 lg:ml-auto"
          >
            {[].map((tag) => (
              <li
                className="flex h-6 items-center justify-center
                rounded-lg bg-gradient-to-b from-white/[.105] to-white/[.15] px-4 py-1 text-xs text-white ring-1 ring-inset ring-white/10 transition-all hover:to-white/[.25]"
              >
                <a href={`/tags/${tag}`}>{tag}</a>
              </li>
            ))}
          </ol>
        </div>
        <ul className="relative mt-12 grid list-none grid-cols-1 gap-2 rounded-3xl bg-gradient-to-t from-white/20 p-2 ring-1 ring-white/10 md:grid-cols-3 lg:mt-24">
          {allTemplates.map((template) => (
            <TemplateCard template={template} />
          ))}
        </ul>
      </section>
    </>
  );
};

export default Page;

const TemplateCard = ({ template }: { template: Template }) => {
  return (
    <li>
      <Link
        href={`/templates/${template.slug}`}
        title={template.title}
        className="bg-card/80 group flex h-full flex-col justify-between rounded-2xl p-2 shadow-massive ring-1 ring-white/10 backdrop-blur-2xl"
      >
        <article className="flex h-full flex-1 flex-col">
          <div className="block w-full lg:col-span-2">
            {template.heroImage && (
              <img
                className="aspect-[384/246] h-full rounded-2xl bg-center object-cover"
                src={template.heroImage}
                alt={template.title}
              />
            )}
          </div>
          <div className="mt-4 flex w-full flex-1 flex-col items-start justify-between p-4">
            <div className="w-full">
              <div>
                <p className="font-display text-lg text-ui-fg-base lg:text-xl">
                  {template.title}
                </p>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-ui-fg-subtle">
                {template.brief}
              </p>
            </div>
            <footer>
              <div className="mt-6 inline-flex items-center space-x-1 text-ui-fg-base">
                <p className="text-xs">Kai</p>
                <span aria-hidden="true">&middot;</span>
                <div className="flex text-xs">
                  <time dateTime="2020-03-16"> 2020-03-16</time>
                </div>
              </div>
            </footer>
          </div>
        </article>
      </Link>
    </li>
  );
};
