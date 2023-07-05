"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  type MotionValue,
} from "framer-motion";
import { classed, cn } from "~/lib/utils";
import { GridPattern, type GridPatternProps } from "~/components/GridPattern";

export const Card = classed("article", {
  base: "",
  variants: {
    variant: {
      normal: "bg-zinc-800 rounded shadow",
      highlight: "rounded-2xl bg-zinc-900/90 shadow-highlight",
    },
    size: {
      md: "p-4",
      lg: "py-10 px-10 md:px-12",
    },
  },
  defaultVariants: {
    variant: "normal",
    size: "md",
  },
});

const Pattern = ({
  mouseX,
  mouseY,
  ...gridProps
}: {
  mouseX: MotionValue<any>;
  mouseY: MotionValue<any>;
  gridProps?: Omit<GridPatternProps, "width" | "height">;
}) => {
  const maskImage = useMotionTemplate`radial-gradient(1000px at ${mouseX}px ${mouseY}px, rgba(255,255,255,.5), transparent 40%)`;
  const style = { maskImage, WebkitMaskImage: maskImage };

  return (
    <div className="pointer-events-none">
      <div className="absolute inset-0 rounded-2xl transition duration-300 [mask-image:linear-gradient(white,transparent)] group-hover:opacity-50">
        <GridPattern
          width={72}
          height={56}
          x="50%"
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full fill-white/[0.025] stroke-white/5"
          {...gridProps}
        />
      </div>
      <motion.div
        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#202e26] to-[#28342e] opacity-0 transition duration-300 group-hover:opacity-100"
        style={style}
      />
      <motion.div
        className="absolute inset-0 rounded-2xl opacity-0 mix-blend-overlay transition duration-300 group-hover:opacity-100"
        style={style}
      >
        <GridPattern
          width={72}
          height={56}
          x="50%"
          className="absolute inset-x-0 inset-y-[-30%] h-[160%] w-full fill-white/[0.025] stroke-white/10"
          {...gridProps}
        />
      </motion.div>
    </div>
  );
};

export const HighlightCard = ({
  className,
  gridProps,
  children,
  pattern = null,
  ...props
}: {
  className?: string;
  gridProps?: Omit<GridPatternProps, "width" | "height">;
  pattern?: React.ReactNode;
  children?: React.ReactNode;
} & React.ComponentProps<typeof Card>) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const onMouseMove = ({
    currentTarget,
    clientX,
    clientY,
  }: React.MouseEvent) => {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  };

  return (
    <Card
      variant="highlight"
      className={cn("group relative", className)}
      onMouseMove={onMouseMove}
      {...props}
    >
      {pattern}
      <Pattern {...gridProps} mouseX={mouseX} mouseY={mouseY} />
      <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/0 group-hover:ring-white/5" />
      <div className="relative h-full">{children}</div>
    </Card>
  );
};
