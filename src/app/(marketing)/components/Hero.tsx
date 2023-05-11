import { Badge } from "~/components/Badge2";
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
          <span className="block bg-gradient-to-b from-emerald-300 to-green-600 bg-clip-text text-transparent">
            Personalized AI assistant
          </span>
          <span>built for teams</span>
        </SectionTitle>
        <p className="mx-auto mt-6 max-w-lg text-gray-400">
          A collaborative, privacy-first, and hyper-relevant AI engine that fits
          effortlessly into your workflow
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
          className="pointer-events-none absolute inset-0 translate-y-10 opacity-50 mix-blend-lighten hue-rotate-[250deg] [mask-image:linear-gradient(transparent_10%,black,transparent)]"
        >
          <source src="/assets/home-hero-bg.mov" />
        </video>
        <HeroBackgroundImage />
      </div>
    </>
  );
};
