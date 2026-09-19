"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import { useRadius } from "@repo/ui/lib/radius-context";
import type { RadiusClasses } from "@repo/ui/lib/radius-context";
import { spring } from "@repo/ui/lib/springs";

interface ProximityFocusRingProps {
  // `| undefined` spelled out for the same sparse itemRects[i] read
  rect: ItemRect | null | undefined;
  radius?: RadiusClasses;
}

const ProximityFocusRing = ({ rect, radius }: ProximityFocusRingProps) => {
  const ambientRadius = useRadius();
  const resolved = radius ?? ambientRadius;
  return (
    <AnimatePresence>
      {rect && (
        <motion.div
          className={`absolute ${resolved.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
          initial={false}
          animate={{
            height: rect.height + 4,
            left: rect.left - 2,
            top: rect.top - 2,
            width: rect.width + 4,
          }}
          exit={{ opacity: 0, transition: spring.fast.exit }}
          transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
        />
      )}
    </AnimatePresence>
  );
};

interface ProximityOverlaysProps {
  // `| undefined` spelled out so a sparse itemRects[i] read passes under exactOptionalPropertyTypes
  activeRect?: ItemRect | null | undefined;
  hoverRect: ItemRect | null;
  focusRect: ItemRect | null;
  // keys the hover overlay so re-entering fades in at the current row instead of sliding from the last
  session: number;
  radius?: RadiusClasses;
}

export const ProximityOverlays = ({
  activeRect = null,
  hoverRect,
  focusRect,
  session,
  radius,
}: ProximityOverlaysProps) => {
  const ambientRadius = useRadius();
  const resolved = radius ?? ambientRadius;
  return (
    <>
      <AnimatePresence>
        {activeRect && (
          <motion.div
            className={`absolute ${resolved.bg} bg-active pointer-events-none`}
            initial={false}
            animate={{
              height: activeRect.height,
              left: activeRect.left,
              opacity: 1,
              top: activeRect.top,
              width: activeRect.width,
            }}
            exit={{ opacity: 0, transition: spring.moderate.exit }}
            transition={{ ...spring.moderate, opacity: { duration: 0.08 } }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hoverRect && (
          <motion.div
            key={session}
            className={`absolute ${resolved.bg} bg-hover pointer-events-none`}
            initial={{
              height: activeRect?.height ?? hoverRect.height,
              left: activeRect?.left ?? hoverRect.left,
              opacity: 0,
              top: activeRect?.top ?? hoverRect.top,
              width: activeRect?.width ?? hoverRect.width,
            }}
            animate={{
              height: hoverRect.height,
              left: hoverRect.left,
              opacity: 1,
              top: hoverRect.top,
              width: hoverRect.width,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
          />
        )}
      </AnimatePresence>

      <ProximityFocusRing rect={focusRect} radius={resolved} />
    </>
  );
};
