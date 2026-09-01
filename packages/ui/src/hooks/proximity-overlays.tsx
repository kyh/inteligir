"use client";

import { AnimatePresence, motion } from "framer-motion";

import type { ItemRect } from "@repo/ui/hooks/use-proximity-hover";
import { useRadius, type RadiusClasses } from "@repo/ui/lib/radius-context";
import { spring } from "@repo/ui/lib/springs";

interface ProximityOverlaysProps {
  /** The persistent selected/active background, when the list has one.
   *  `| undefined` spelled out so a sparse `itemRects[i]` read can be passed
   *  under exactOptionalPropertyTypes. */
  activeRect?: ItemRect | null | undefined;
  hoverRect: ItemRect | null;
  focusRect: ItemRect | null;
  /** Bumped per pointer entry — keys the hover overlay so re-entering fades
   *  in at the current row instead of sliding over from the last one. */
  session: number;
  /** Overrides the ambient radius — for surfaces that opt out of the global
   *  radius context (popup menus pin `radiusMap.rounded`). */
  radius?: RadiusClasses;
}

/** The traveling highlight trio every proximity-hover list draws inside its
 *  `position: relative` container: active background, hover background, and
 *  the keyboard focus ring, each gliding between the measured row rects. One
 *  component so the three can never drift apart per consumer. */
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
      {/* Active / selected background */}
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

      {/* Hover background — enters at the active rect when there is one, so
          the highlight reads as lifting off the selection. */}
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

      {/* Focus ring — 2px outside the row so the corners stay concentric. */}
      <AnimatePresence>
        {focusRect && (
          <motion.div
            className={`absolute ${resolved.focusRing} pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]`}
            initial={false}
            animate={{
              left: focusRect.left - 2,
              top: focusRect.top - 2,
              width: focusRect.width + 4,
              height: focusRect.height + 4,
            }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={{ ...spring.fast, opacity: { duration: 0.08 } }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
