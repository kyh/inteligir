// ---------------------------------------------------------------------------
// Shared motion vocabulary for the AI capsule. The composer and its response
// popover are styled as ONE spring-morphing surface — same radius, same ring,
// same spring — so every state change reads as a single object stretching,
// never a cut between panels. The decorative treatments (listening orb +
// glow aura, thinking sweep) live here so both halves stay visually locked.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion, type Transition } from "framer-motion";

import type { DisplayStatus } from "@repo/ui/components/geometric-orb";

import { LazyGeometricOrb } from "@repo/workspace/components/lazy-orb";
import { useOrbBaseColor } from "@repo/workspace/lib/use-theme";

/** One spring drives every capsule size/shape change (via useCapsuleSpring). */
const CAPSULE_SPRING: Transition = { type: "spring", duration: 0.55, bounce: 0.3 };

/** Continuous corner radius across every capsule state (px). Applied via the
 * motion `style` prop so layout animations scale-correct the corners. The
 * hardcoded `rounded-[24px]`/`rounded-[22.5px]` below are this value and its
 * 1.5px-inset counterpart. */
export const CAPSULE_RADIUS = 24;

/** The capsule's shared surface chrome (radius comes from CAPSULE_RADIUS). */
export const CAPSULE_SURFACE =
  "relative overflow-hidden bg-popover text-popover-foreground shadow-lg shadow-black/5 ring-1 ring-border";

/** The content crossfade every capsule state change shares: content blurs in a
 * beat after the shape settles, so the shape reads first and details second.
 * Stable identities (vs inline literals) also let framer skip re-diffing. */
export const CAPSULE_CONTENT_HIDDEN = { opacity: 0, scale: 0.96, filter: "blur(6px)" };
export const CAPSULE_CONTENT_VISIBLE = { opacity: 1, scale: 1, filter: "blur(0px)" };

/** The capsule's reduced-motion-aware transitions: `capsule` drives the shape
 * (layout spring), `content` the crossfade (same spring, a beat later). One
 * derivation for every consumer instead of a per-file `useReducedMotion` dance;
 * `reduceMotion` rides along for props that need the raw flag (e.g. `layout`). */
export function useCapsuleSpring(): {
  capsule: Transition;
  content: Transition;
  reduceMotion: boolean;
} {
  const reduceMotion = useReducedMotion() === true;
  if (reduceMotion) {
    return { capsule: { duration: 0 }, content: { duration: 0 }, reduceMotion };
  }
  return { capsule: CAPSULE_SPRING, content: { ...CAPSULE_SPRING, delay: 0.05 }, reduceMotion };
}

/** The focal voice animation while a voice surface is live: the shared
 * GeometricOrb, defaulting to its "listening" mood. The conversation surface
 * drives `status` through the other moods (starting / busy / speaking) so ONE
 * indicator carries the whole hands-free loop. It's a WebGL canvas, so it gets
 * a fixed square box; the base color tracks the theme (shared with the
 * initial-surface orb). Fewer, thinner strands than the hero placement so the
 * sphere reads at ~44px. The orb keeps its own internal animation under
 * prefers-reduced-motion. */
export function ListeningOrb({ status = "listening" }: { status?: DisplayStatus }) {
  const baseColor = useOrbBaseColor();
  return (
    <div aria-hidden className="size-11 shrink-0">
      <LazyGeometricOrb status={status} baseColor={baseColor} numLines={12} lineWidth={1.5} />
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
