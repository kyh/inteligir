"use client";

import { useEffect, useState } from "react";
import { cn } from "@kyh/ui/utils";

type MeteorsProps = {
  top?: number;
  number?: number;
};

export const Meteors = ({ top = -5, number = 20 }: MeteorsProps) => {
  const [meteorStyles, setMeteorStyles] = useState<React.CSSProperties[]>([]);

  useEffect(() => {
    const styles = [...new Array(number)].map(() => ({
      top,
      left: Math.floor(Math.random() * window.innerWidth) + "px",
      animationDelay: Math.random() * 1 + 0.2 + "s",
      animationDuration: Math.floor(Math.random() * 8 + 2) + "s",
    }));
    setMeteorStyles(styles);
  }, [top, number]);

  return (
    <div className="pointer-events-none absolute inset-0 h-full w-full rotate-y-180 overflow-hidden">
      {[...meteorStyles].map((style, idx) => (
        <span
          key={idx}
          className={cn(
            "animate-meteor pointer-events-none absolute top-1/2 left-1/2 h-0.5 w-0.5 rotate-[2deg] rounded-[9999px] bg-slate-500 shadow-[0_0_0_1px_#ffffff10]",
          )}
          style={style}
        >
          <span className="pointer-events-none absolute top-1/2 -z-10 h-[1px] w-[50px] -translate-y-1/2 bg-linear-to-r from-slate-500 to-transparent" />
        </span>
      ))}
    </div>
  );
};
