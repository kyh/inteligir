import { WaitlistForm } from "./_components/waitlist-form";

const features = [
  {
    title: "Vibedgames",
    description:
      "An AI-powered video game generator with built-in multiplayer and mobile support. Describe a game, play it instantly.",
  },
  {
    title: "OS¹",
    description:
      "An artificially intelligent operating system that lives on your desktop. It understands you, adapts to you, and gets smarter the more you use it.",
  },
  {
    title: "More coming soon",
    description:
      "New experiments are always in the works. Stay tuned.",
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
            Exploring the future of functional AI.
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
        <h2 className="text-base font-medium text-foreground">
          Stay in the loop
        </h2>
        <div className="mt-3 border-t border-dotted border-foreground/10 pt-3 text-balance">
          <p className="text-sm text-foreground/60">
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
