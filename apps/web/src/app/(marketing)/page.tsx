import { WaitlistForm } from "./_components/waitlist-form";

const features = [
  {
    title: "Manages your tasks",
    description:
      "Triages, prioritizes, and tracks work across projects. Nothing falls through the cracks.",
  },
  {
    title: "Coordinates your workflows",
    description:
      "Orchestrates multi-step workflows across tools and teams without manual glue.",
  },
  {
    title: "Runs locally on your machine",
    description:
      "A desktop app that keeps your data with you. No cloud lock-in, no third-party access.",
  },
  {
    title: "Learns your patterns",
    description:
      "Adapts to your preferences and priorities over time. The more you use it, the sharper it gets.",
  },
];

const Page = () => {
  return (
    <main>
      {/* Hero */}
      <section className="pt-24 pb-16 lg:pt-48">
        <div>
          <h1 className="text-base font-medium text-foreground">
            Your AI Chief of Staff.
          </h1>
          <p className="text-base text-foreground/60 text-balance">
            An AI agent that manages your tasks, coordinates your workflows, and
            keeps everything on track &mdash; all from a desktop app that runs
            locally on your machine.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16">
        <h2 className="text-base font-medium text-foreground">
          What Inteligir does
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
            Get early access
          </h2>
          <p className="text-base text-foreground/60 text-balance">
            Inteligir is in development. Join the waitlist to be first in line.
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
