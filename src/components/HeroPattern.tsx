import { GridPattern } from "~/components/GridPattern";

export function HeroPattern() {
  return (
    <div className="absolute inset-0 top-0 -z-10 [mask-image:linear-gradient(white,transparent_75%)]">
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
}
