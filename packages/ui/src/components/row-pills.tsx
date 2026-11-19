"use client";

import { AnimatePresence, motion } from "motion/react";

import { radius } from "@repo/ui/lib/radius";
import type { RowBox } from "@repo/ui/lib/row-box";
import { spring } from "@repo/ui/lib/springs";

type Tier = typeof spring.fast | typeof spring.moderate;

const placed = { duration: 0 };

const glide = (box: RowBox, tier: Tier) =>
  box.travels ? { ...tier, opacity: { duration: 0.08 } } : placed;

const FocusRing = ({ box }: { box: RowBox | null }) => (
  <AnimatePresence>
    {box && (
      <motion.div
        className={`absolute ${radius.focusRing} pointer-events-none z-20 border border-focus-ring`}
        initial={false}
        animate={{
          height: box.rect.height + 4,
          left: box.rect.left - 2,
          top: box.rect.top - 2,
          width: box.rect.width + 4,
        }}
        exit={{ opacity: 0, transition: spring.fast.exit }}
        transition={glide(box, spring.fast)}
      />
    )}
  </AnimatePresence>
);

interface RowPillsProps {
  active?: RowBox | null;
  hover: RowBox | null;
  focus: RowBox | null;
  session: number;
}

export const RowPills = ({ active = null, hover, focus, session }: RowPillsProps) => (
  <>
    <AnimatePresence>
      {active && (
        <motion.div
          className={`absolute ${radius.bg} bg-active pointer-events-none`}
          initial={false}
          animate={{ ...active.rect, opacity: 1 }}
          exit={{ opacity: 0, transition: spring.moderate.exit }}
          transition={glide(active, spring.moderate)}
        />
      )}
    </AnimatePresence>

    <AnimatePresence>
      {hover && (
        <motion.div
          key={session}
          className={`absolute ${radius.bg} bg-hover pointer-events-none`}
          initial={{ ...(active ?? hover).rect, opacity: 0 }}
          animate={{ ...hover.rect, opacity: 1 }}
          exit={{ opacity: 0, transition: spring.fast.exit }}
          transition={glide(hover, spring.fast)}
        />
      )}
    </AnimatePresence>

    <FocusRing box={focus} />
  </>
);
