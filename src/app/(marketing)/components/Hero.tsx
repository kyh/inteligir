import { Badge } from "~/components/Badge";
import { GridPattern } from "~/components/GridPattern";
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

const HeroPattern = () => {
  return (
    <div className="absolute inset-0 -z-10 [mask-image:linear-gradient(white,transparent_75%)]">
      <GridPattern
        width={72}
        height={56}
        x="-12"
        y="4"
        squares={[
          [4, 3],
          [2, 1],
          [7, 3],
          [10, 6],
        ]}
        className="h-full w-full fill-white/2.5 stroke-white/5 mix-blend-overlay"
      />
    </div>
  );
};
