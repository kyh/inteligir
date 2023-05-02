import { Badge } from "~/components/Badge";
import { HeroPattern } from "~/components/HeroPattern";
import { HeroBackgroundImage } from "./HeroBackgroundImage";
import { SectionTitle } from "./SectionTitle";

export const Hero = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <HeroPattern />
      <section className="px-5 pt-[70px] sm:pt-[100px]">
        <div className="flex justify-center gap-1 text-xs">
          <Badge color="transparent">v0.0.1</Badge>
        </div>
        <SectionTitle>
          Make all the APIs you use
          <span className="block bg-gradient-to-b from-emerald-300 to-green-600 bg-clip-text text-transparent">
            faster and more reliable.
          </span>
        </SectionTitle>
        <p className="mx-auto mt-6 max-w-lg text-gray-400">
          A simple caching service deployed on the edge across the globe. <br />
          Say goodbye to one of the hard things in software development.
        </p>
        {children}
      </section>
      <div className="full-bleed relative min-h-[30vh]">
        <video
          preload="metadata"
          loop
          autoPlay
          muted
          playsInline
          className="pointer-events-none absolute left-0 right-0 top-0 w-full translate-y-10 opacity-50 mix-blend-lighten hue-rotate-[250deg] [mask-image:linear-gradient(transparent_10%,black,transparent)]"
        >
          <source src="/assets/home-hero-bg.mov" />
        </video>
        <HeroBackgroundImage />
      </div>
    </>
  );
};
