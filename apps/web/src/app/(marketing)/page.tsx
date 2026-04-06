import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { WaitlistForm } from "./_components/waitlist-form";

const apps = [
  {
    title: "Vibedgames",
    description: "Describe a game, play it instantly. With friends.",
    url: "https://vibedgames.com",
  },
  {
    title: "OS¹",
    description:
      "An artificially intelligent operating system. Tailored for you.",
    url: "/os1",
  },
];

const Page = () => {
  return (
    <main>
      <section className="pt-24 pb-16 lg:pt-48">
        <div>
          <h1 className="text-base font-medium text-foreground">
            An agent experiment lab.
          </h1>
          <p className="text-base text-foreground/60 text-balance">
            Exploring the future of functional AI.
          </p>
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-base font-medium text-foreground">Explorations</h2>
        <div className="mt-3 grid gap-8 border-t border-dotted border-foreground/10 pt-3 text-balance md:grid-cols-2">
          {apps.map((item) => {
            const isExternal = item.url.startsWith("http");
            return (
              <Link
                key={item.title}
                href={item.url}
                {...(isExternal && {
                  target: "_blank",
                  rel: "noopener noreferrer",
                })}
                className="group block"
              >
                <div>
                  <h3 className="flex items-center gap-2 text-sm text-foreground">
                    <span>{item.title}</span>
                    <ExternalLink
                      className="size-3 shrink-0 text-foreground/60 opacity-0 transition-none group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                  </h3>
                  <p className="mt-1 text-sm text-foreground/60">
                    {item.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="py-16">
        <h2 className="text-base font-medium text-foreground">
          Stay in the loop
        </h2>
        <div className="mt-6">
          <WaitlistForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16">
        <p className="text-xs text-foreground/30">
          &copy; {new Date().getFullYear()} Kaiyu Hsu
        </p>
      </footer>
    </main>
  );
};

export default Page;
