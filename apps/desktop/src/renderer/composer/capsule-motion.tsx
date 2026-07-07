// ---------------------------------------------------------------------------
// Shared motion vocabulary for the AI capsule. The composer and its response
// popover are styled as ONE spring-morphing surface — same radius, same ring,
// same spring — so every state change reads as a single object stretching,
// never a cut between panels. The decorative treatments (listening wave +
// glow aura, thinking sweep) live here so both halves stay visually locked.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion, type Transition } from "framer-motion";

/** One spring drives every capsule size/shape change. */
export const CAPSULE_SPRING: Transition = { type: "spring", duration: 0.55, bounce: 0.3 };

/** Continuous corner radius across every capsule state (px). Applied via the
 * motion `style` prop so layout animations scale-correct the corners. The
 * hardcoded `rounded-[24px]`/`rounded-[22.5px]` below are this value and its
 * 1.5px-inset counterpart. */
export const CAPSULE_RADIUS = 24;

/** The capsule's shared surface chrome (radius comes from CAPSULE_RADIUS). */
export const CAPSULE_SURFACE =
  "relative overflow-hidden bg-popover text-popover-foreground shadow-lg shadow-black/5 ring-1 ring-border";

const BAR_COUNT = 27;

/** Animated voice bars. Heights are deterministic pseudo-random (a fixed
 * envelope × per-bar wobble) so the wave reads organic without re-rolling on
 * re-render. Renders static mid-height bars under prefers-reduced-motion. */
export function ListeningWave() {
  const reduceMotion = useReducedMotion() === true;
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden">
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        const envelope = 0.3 + 0.7 * Math.sin((index / (BAR_COUNT - 1)) * Math.PI);
        const wobble = 0.45 + (Math.sin(index * 12.9898) * 0.5 + 0.5) * 0.55;
        if (reduceMotion) {
          return (
            <div
              key={index}
              className="h-7 w-[3px] rounded-full bg-primary"
              style={{ transform: `scaleY(${envelope * wobble})` }}
            />
          );
        }
        return (
          <motion.div
            key={index}
            className="h-7 w-[3px] rounded-full bg-primary"
            animate={{ scaleY: [0.12, envelope * wobble, 0.22, envelope, 0.12] }}
            transition={{
              duration: 0.9 + (index % 5) * 0.13,
              repeat: Infinity,
              ease: "easeInOut",
              delay: (index % 7) * 0.07,
            }}
          />
        );
      })}
    </div>
  );
}

/** Pulsing conic-gradient aura behind the capsule while listening. The rainbow
 * gradient is intentionally theme-independent — an accent that reads on both
 * light and dark surfaces. Render inside an <AnimatePresence>, as a sibling
 * BEHIND the capsule (the capsule's opaque surface covers the center). */
export function ListeningGlow() {
  const reduceMotion = useReducedMotion() === true;
  const surface =
    "pointer-events-none absolute -inset-2 rounded-[32px] bg-[conic-gradient(from_0deg,#60a5fa,#a78bfa,#f472b6,#38bdf8,#60a5fa)] blur-xl";
  if (reduceMotion) return <div aria-hidden className={surface} style={{ opacity: 0.4 }} />;
  return (
    <motion.div
      aria-hidden
      className={surface}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: [0.35, 0.6, 0.35], scale: 1 }}
      // Exit carries its OWN transition: without it the repeat-Infinity pulse
      // below applies to the fade-out too, which then never completes and the
      // glow lingers forever.
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.4, ease: "easeOut" } }}
      transition={{ opacity: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } }}
    />
  );
}

/** Rotating violet→cyan border sweep while the agent thinks. The inner fill
 * matches the capsule surface so only a ~1.5px rim of the gradient shows.
 * Mount as the FIRST child of the capsule inside an <AnimatePresence>;
 * content after it must be `relative` to paint above the fill. */
export function ThinkingSweep() {
  const reduceMotion = useReducedMotion() === true;
  const gradient =
    "absolute inset-[-150%] bg-[conic-gradient(from_0deg,transparent_0%,transparent_62%,#a78bfa_80%,#67e8f9_90%,transparent_100%)]";
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {reduceMotion ? (
        <div className={gradient} />
      ) : (
        <motion.div
          className={gradient}
          animate={{ rotate: 360 }}
          transition={{ duration: 1.6, ease: "linear", repeat: Infinity }}
        />
      )}
      <div className="absolute inset-[1.5px] rounded-[22.5px] bg-popover" />
    </motion.div>
  );
}
