import { WaitlistForm } from "./_components/waitlist-form";

const features = [
  {
    title: "vibedgames",
    description:
      "An AI-powered video game generator with built-in multiplayer and mobile support. Describe a game, play it instantly.",
  },
  {
    title: "samantha",
    description:
      "An intuitive AI assistant that lives on your desktop. It learns how you think, adapts to how you work, and gets better the more you use it.",
  },
  {
    title: "What's next?",
    description:
      "We're always looking for the next experiment. Have an idea for an agentic app? Let us know.",
  },
];

const Page = () => {
  return (
    <main>
      {/* Hero */}
      <section className="pt-24 pb-16 lg:pt-48">
        <div>
          <h1 className="text-base font-medium text-foreground">
            An agent experiment lab.
          </h1>
          <p className="text-base text-foreground/60 text-balance">
            Exploring what&apos;s possible when you give AI agents real jobs to
            do.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16">
        <h2 className="text-base font-medium text-foreground">
          What we&apos;re building
        </h2>
        <div className="mt-3 grid gap-8 border-t border-dotted border-foreground/10 pt-3 text-balance md:grid-cols-2">
          {features.map((item) => (
            <div key={item.title}>
              <h3 className="text-sm text-foreground">{item.title}</h3>
              <p className="mt-1 text-sm text-foreground/60">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="border-t border-dotted border-foreground/10 pt-4">
          <h2 className="text-base font-medium text-foreground">
            Stay in the loop
          </h2>
          <p className="text-base text-foreground/60 text-balance">
            We&apos;re shipping new experiments all the time. Drop your email to
            follow along.
          </p>
          <WaitlistForm />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16">
        <p className="text-xs text-foreground/30">
          &copy; {new Date().getFullYear()} Inteligir
        </p>
      </footer>
    </main>
  );
};

export default Page;
