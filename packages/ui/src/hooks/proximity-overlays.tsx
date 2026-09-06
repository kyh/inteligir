"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import { useRadius, type RadiusClasses } from "@repo/ui/lib/radius-context";
import { spring } from "@repo/ui/lib/springs";

interface ProximityOverlaysProps {
  // `| undefined` spelled out so a sparse itemRects[i] read passes under exactOptionalPropertyTypes
  activeRect?: ItemRect | null | undefined;
  hoverRect: ItemRect | null;
  focusRect: ItemRect | null;
  // keys the hover overlay so re-entering fades in at the current row instead of sliding from the last
  session: number;
  radius?: RadiusClasses;
}

export function ProximityOverlays({
  activeRect = null,
  hoverRect,
  focusRect,
  session,
  radius,
}: ProximityOverlaysProps) {
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
              top: activeRect.top,
              left: activeRect.left,
              width: activeRect.width,
              height: activeRect.height,
              opacity: 1,
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
              opacity: 0,
              top: activeRect?.top ?? hoverRect.top,
              left: activeRect?.left ?? hoverRect.left,
              width: activeRect?.width ?? hoverRect.width,
              height: activeRect?.height ?? hoverRect.height,
            }}
            animate={{
              opacity: 1,
              top: hoverRect.top,
              left: hoverRect.left,
              width: hoverRect.width,
              height: hoverRect.height,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
          />
        )}
      </AnimatePresence>

      <ProximityFocusRing rect={focusRect} radius={resolved} />
    </>
  );
}

interface ProximityFocusRingProps {
  // `| undefined` spelled out for the same sparse itemRects[i] read
  rect: ItemRect | null | undefined;
  radius?: RadiusClasses;
}

function ProximityFocusRing({ rect, radius }: ProximityFocusRingProps) {
  const ambientRadius = useRadius();
  const resolved = radius ?? ambientRadius;
  return (
    <AnimatePresence>
      {rect && (
        <motion.div
          className={`absolute ${resolved.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
          initial={false}
          animate={{
            left: rect.left - 2,
            top: rect.top - 2,
            width: rect.width + 4,
            height: rect.height + 4,
          }}
          exit={{ opacity: 0, transition: spring.fast.exit }}
          transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
        />
      )}
    </AnimatePresence>
  );
}
