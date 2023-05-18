import { Badge } from "~/components/Badge";
import { HeroPattern } from "~/components/HeroPattern";
import { HeroBackgroundImage } from "./HeroBackgroundImage";
import { SectionTitle } from "./SectionTitle";

type Props = {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  description: React.ReactNode;
  action: React.ReactNode;
};

export const Hero = ({ title, subtitle, description, action }: Props) => {
  return (
    <>
      <HeroPattern />
      <section className="px-5 pt-[70px] sm:pt-[100px]">
        <div className="flex justify-center gap-1 text-xs">
          <Badge color="transparent">v0.0.1</Badge>
        </div>
        <SectionTitle>
          <span className="block bg-gradient-to-b from-emerald-300 to-green-600 bg-clip-text text-transparent">
            {title}
          </span>
          <span>{subtitle}</span>
        </SectionTitle>
        <p className="mx-auto mt-6 max-w-md whitespace-pre-line text-zinc-400">
          {description}
        </p>
        <div className="mt-8 grid items-start justify-center">{action}</div>
      </section>
      <div className="full-bleed relative min-h-[30vh]">
        <video
          preload="metadata"
          loop
          autoPlay
          muted
          playsInline
          className="pointer-events-none absolute inset-0 translate-y-10 opacity-50 mix-blend-lighten hue-rotate-[250deg] [mask-image:linear-gradient(transparent_10%,black,transparent)]"
        >
          <source src="/assets/home-hero-bg.mov" />
        </video>
        <HeroBackgroundImage />
      </div>
    </>
  );
};
