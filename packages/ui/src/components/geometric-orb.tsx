"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, extend, type ThreeElement } from "@react-three/fiber";

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

export type DisplayStatus = "idle" | "busy" | "error" | "starting" | "listening" | "speaking";

/* r3f's documented extension point for a non-built-in element, kept next to the
   `extend()` call that registers it (the r3f v9 docs' own pattern; a
   `declare global { namespace JSX }` shim is the v8 spelling and does not
   apply). It has to live in a MODULE rather than
   an ambient .d.ts: consumers pull this file into their programs through the
   `@repo/ui/*` paths mapping, which brings the module they import but never an
   unreferenced declaration file sitting beside it. */
declare module "@react-three/fiber" {
  interface ThreeElements {
    line2: ThreeElement<typeof Line2>;
  }

  /* CanvasProps `extends React.HTMLAttributes<HTMLDivElement>`, but that clause
     conflicts with r3f's RenderProps event handlers under TS6, so the inherited
     DOM attributes get dropped. Re-add the one this file passes to <Canvas>. */
  interface CanvasProps {
    className?: string;
  }
}

extend({ Line2, LineMaterial, LineGeometry });

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const DEFAULT_NUM_LINES = 20;
const RADIUS = 1.5;
const POINTS_PER_LINE = 96;
const DEFAULT_LINE_WIDTH = 2;
const INITIAL_COLOR_INT = new THREE.Color("#eeeeee").getHex();
const PI2 = Math.PI * 2;

// Helix proportions — same shape as reference, scaled to fit camera
const HELIX_LENGTH = 2.8;
const HELIX_AMPLITUDE = HELIX_LENGTH * (5.6 / 30);
const HELIX_TUBE_RADIUS = HELIX_AMPLITUDE * (1.1 / 5.6);

// Camera fixed
const CAMERA_Z = 5;

// Reference animation constant
const ROTATE_VALUE = 0.035;

// ---------------------------------------------------------------------------
// Mood system
// ---------------------------------------------------------------------------

type Mood = {
  speed: number;
  squiggleAmount: number;
  squiggleFrequency: number;
  squiggleSpeed: number;
  morphProgress: number;
  helixSpin: number;
  r: number;
  g: number;
  b: number;
};

const tmpColor = new THREE.Color();

// The idle/starting states use a neutral base color that tracks the active
// theme so the orb stays legible on both light and dark backgrounds; the
// other states keep their semantic hues (visible against either background).
function makeMoods(baseColor: string): Record<DisplayStatus, Mood> {
  return {
    idle: {
      speed: 20,
      squiggleAmount: 0.04,
      squiggleFrequency: 4,
      squiggleSpeed: 2,
      morphProgress: 1,
      helixSpin: 0,
      ...rgb(baseColor),
    },
    busy: {
      speed: 10,
      squiggleAmount: 0.08,
      squiggleFrequency: 6,
      squiggleSpeed: 5,
      morphProgress: 1,
      helixSpin: 0,
      ...rgb("#66bbff"),
    },
    error: {
      speed: 14,
      squiggleAmount: 0.12,
      squiggleFrequency: 8,
      squiggleSpeed: 7,
      morphProgress: 1,
      helixSpin: 0,
      ...rgb("#ff6666"),
    },
    starting: {
      speed: 25,
      squiggleAmount: 0.01,
      squiggleFrequency: 2,
      squiggleSpeed: 1,
      morphProgress: 0,
      helixSpin: ROTATE_VALUE,
      ...rgb(baseColor),
    },
    listening: {
      speed: 15,
      squiggleAmount: 0.06,
      squiggleFrequency: 5,
      squiggleSpeed: 3,
      morphProgress: 1,
      helixSpin: 0,
      ...rgb("#44dd88"),
    },
    speaking: {
      speed: 8,
      squiggleAmount: 0.1,
      squiggleFrequency: 7,
      squiggleSpeed: 6,
      morphProgress: 1,
      helixSpin: 0,
      ...rgb("#aa88ff"),
    },
  };
}

function rgb(hex: string): { r: number; g: number; b: number } {
  tmpColor.set(hex);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b };
}

const LERP_SPEED = 3;

// Spin-up phase durations (seconds)
const ACCEL_DURATION = 2.5;
const MORPH_DURATION = 2.0;
const SPIN_UP_DURATION = ACCEL_DURATION + MORPH_DURATION;

/**
 * Reference easing — quadratic ease-in, cubic ease-out.
 */
function referenceEasing(t: number): number {
  const u = t * 2;
  if (u < 1) return 0.5 * u * u;
  const s = u - 2;
  return 0.5 * (s * s * s + 2);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpMood(current: Mood, target: Mood, alpha: number): void {
  current.speed += (target.speed - current.speed) * alpha;
  current.squiggleAmount += (target.squiggleAmount - current.squiggleAmount) * alpha;
  current.squiggleFrequency += (target.squiggleFrequency - current.squiggleFrequency) * alpha;
  current.squiggleSpeed += (target.squiggleSpeed - current.squiggleSpeed) * alpha;
  current.morphProgress += (target.morphProgress - current.morphProgress) * alpha;
  current.helixSpin += (target.helixSpin - current.helixSpin) * alpha;
  current.r += (target.r - current.r) * alpha;
  current.g += (target.g - current.g) * alpha;
  current.b += (target.b - current.b) * alpha;
}

// ---------------------------------------------------------------------------
// Helix curve — identical to reference
// ---------------------------------------------------------------------------

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  // eslint-disable-next-line no-useless-constructor -- exposes protected base constructor
  constructor() {
    super();
  }

  override getPoint(percent: number): THREE.Vector3 {
    const x = HELIX_LENGTH * Math.sin(PI2 * percent);
    const y = HELIX_AMPLITUDE * Math.cos(PI2 * 3 * percent);

    const quarter = percent % 0.25;
    const tNorm = quarter / 0.25;
    const segment = Math.floor(percent / 0.25);
    let t = quarter - (2 * (1 - tNorm) * tNorm * -0.0185 + tNorm * tNorm * 0.25);
    if (segment === 0 || segment === 2) {
      t *= -1;
    }
    const z = HELIX_AMPLITUDE * Math.sin(PI2 * 2 * (percent - t));

    return new THREE.Vector3(x, y, z);
  }
}

function helixPoint(percent: number, tubeAngle: number): [number, number, number] {
  const x = HELIX_LENGTH * Math.sin(PI2 * percent);
  const y = HELIX_AMPLITUDE * Math.cos(PI2 * 3 * percent);

  const quarter = percent % 0.25;
  const tNorm = quarter / 0.25;
  const segment = Math.floor(percent / 0.25);
  let t = quarter - (2 * (1 - tNorm) * tNorm * -0.0185 + tNorm * tNorm * 0.25);
  if (segment === 0 || segment === 2) {
    t *= -1;
  }
  const z = HELIX_AMPLITUDE * Math.sin(PI2 * 2 * (percent - t));

  const offsetY = Math.cos(tubeAngle) * HELIX_TUBE_RADIUS;
  const offsetZ = Math.sin(tubeAngle) * HELIX_TUBE_RADIUS;
  return [x, y + offsetY, z + offsetZ];
}

// ---------------------------------------------------------------------------
// LatitudeLines — all rendering in a single useFrame
// ---------------------------------------------------------------------------

function LatitudeLines({
  status,
  baseColor,
  lineWidth,
  numLines: NUM_LINES,
}: {
  status: DisplayStatus;
  baseColor: string;
  lineWidth: number;
  numLines: number;
}) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const parentGroupRef = useRef<THREE.Group>(null);
  const spinGroupRef = useRef<THREE.Group>(null);
  const [cameraDirection] = useState(() => new THREE.Vector3());
  const helixRotationRef = useRef(0);
  // Theme-reactive moods. useFrame lerps the live mood toward `moods[status]`,
  // so a theme change smoothly recolors the orb without remounting. The refs
  // below read it only for their one-time initial value.
  const moods = useMemo(() => makeMoods(baseColor), [baseColor]);
  const sphereExpandRef = useRef(moods[status].morphProgress > 0.5 ? 1 : 0);
  const { size } = useThree();

  const moodRef = useRef<Mood>({ ...moods[status] });
  const targetRef = useRef(status);
  const prevStatusRef = useRef(status);
  const spinUpRef = useRef<{
    elapsed: number;
    target: DisplayStatus;
  } | null>(null);

  useLayoutEffect(() => {
    if (status !== prevStatusRef.current) {
      if (prevStatusRef.current === "starting" && status !== "starting") {
        spinUpRef.current = { elapsed: 0, target: status };
      }
      prevStatusRef.current = status;
    }
    targetRef.current = status;
  }, [status]);

  // --- Tube mesh ---
  const helixMeshRef = useRef<THREE.Mesh>(null);
  const helixGeometry = useMemo(
    () => new THREE.TubeGeometry(new HelixCurve(), 200, HELIX_TUBE_RADIUS, 2, true),
    [],
  );
  const helixMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
      }),
    [],
  );

  const lineConstants = useMemo(
    () =>
      Array.from({ length: NUM_LINES }, (_, i) => ({
        longitudeRotation: (i / NUM_LINES) * Math.PI,
        tubeAngle: (i / NUM_LINES) * PI2,
      })),
    [NUM_LINES],
  );

  const helixCache = useMemo(() => {
    const cache = new Float32Array(NUM_LINES * POINTS_PER_LINE * 3);
    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
      const tubeAngle = (lineIdx / NUM_LINES) * PI2;
      for (let i = 0; i < POINTS_PER_LINE; i++) {
        const [hx, hy, hz] = helixPoint(i / POINTS_PER_LINE, tubeAngle);
        const idx = (lineIdx * POINTS_PER_LINE + i) * 3;
        cache[idx] = hx;
        cache[idx + 1] = hy;
        cache[idx + 2] = hz;
      }
    }
    return cache;
  }, [NUM_LINES]);

  const materials = useMemo(
    () =>
      Array.from(
        { length: NUM_LINES },
        () =>
          new LineMaterial({
            color: INITIAL_COLOR_INT,
            linewidth: lineWidth,
            transparent: true,
            opacity: 1,
            vertexColors: true,
          }),
      ),
    [lineWidth, NUM_LINES],
  );

  const geometries = useMemo(
    () => Array.from({ length: NUM_LINES }, () => new LineGeometry()),
    [NUM_LINES],
  );

  useEffect(() => {
    return () => {
      for (const mat of materials) mat.dispose();
      for (const geo of geometries) geo.dispose();
      helixGeometry.dispose();
      helixMaterial.dispose();
    };
  }, [materials, geometries, helixGeometry, helixMaterial]);

  useEffect(() => {
    for (const mat of materials) {
      mat.resolution.set(size.width, size.height);
    }
  }, [materials, size.width, size.height]);

  const vertexCount = POINTS_PER_LINE + 1;
  const positionBuffer = useMemo(() => new Float32Array(vertexCount * 3), [vertexCount]);
  const colorBuffer = useMemo(() => new Float32Array(vertexCount * 3), [vertexCount]);

  useFrame((state, delta) => {
    const mood = moodRef.current;
    const spinUp = spinUpRef.current;

    const setTubeVisible = (opacity: number) => {
      helixMaterial.opacity = opacity;
      if (helixMeshRef.current) helixMeshRef.current.visible = opacity > 0.01;
    };
    const setLinesVisible = (opacity: number) => {
      for (const mat of materials) {
        mat.opacity = opacity;
        mat.visible = opacity > 0.01;
      }
    };

    // --- Spin-up transition ---
    if (spinUp) {
      spinUp.elapsed += delta;

      if (spinUp.elapsed <= ACCEL_DURATION) {
        // Acceleration: helix spins + turns to -π/2
        const normalizedTime = Math.min(spinUp.elapsed / ACCEL_DURATION, 1);
        const acceleration = referenceEasing(normalizedTime);

        helixRotationRef.current += (ROTATE_VALUE + acceleration) * delta * 60;
        mood.morphProgress = 0;
        sphereExpandRef.current = 0;

        if (acceleration > 0.35) {
          const progress = (acceleration - 0.35) / 0.65;
          if (parentGroupRef.current) {
            parentGroupRef.current.rotation.y = (-Math.PI / 2) * progress;
            parentGroupRef.current.position.z = 0;
          }
        } else if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = 0;
          parentGroupRef.current.position.z = 0;
        }

        setTubeVisible(1);
        setLinesVisible(0);

        const target = moods[spinUp.target];
        const a = acceleration * 0.05;
        mood.r += (target.r - mood.r) * a;
        mood.g += (target.g - mood.g) * a;
        mood.b += (target.b - mood.b) * a;
      } else {
        // Morph phase: tube → circle lines → expanding sphere
        const morphElapsed = spinUp.elapsed - ACCEL_DURATION;
        const morph = Math.min(morphElapsed / MORPH_DURATION, 1);
        const easedMorph = easeInOutCubic(morph);

        // Decelerate spin
        helixRotationRef.current += (ROTATE_VALUE + 1) * (1 - easedMorph) * delta * 60;

        // morphProgress: helix positions → circle/sphere positions
        mood.morphProgress = easedMorph;

        // sphereExpand: circle → full sphere (delayed past crossfade)
        const expandRaw = Math.max(0, (morph - 0.2) / 0.8);
        sphereExpandRef.current = easeInOutCubic(expandRaw);

        // Tube/line crossfade (quick, first 25% of morph)
        const crossfade = Math.min(morph / 0.25, 1);
        setTubeVisible(1 - crossfade);
        setLinesVisible(crossfade);

        // Group rotation unwinds (delayed past crossfade)
        const unwindRaw = Math.max(0, (morph - 0.2) / 0.8);
        const unwind = easeInOutCubic(unwindRaw);
        if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = (-Math.PI / 2) * (1 - unwind);
          parentGroupRef.current.position.z = 0;
        }

        // Lerp params toward target
        const target = moods[spinUp.target];
        const a = easedMorph * 0.1;
        mood.speed += (target.speed - mood.speed) * a;
        mood.squiggleAmount += (target.squiggleAmount - mood.squiggleAmount) * a;
        mood.squiggleFrequency += (target.squiggleFrequency - mood.squiggleFrequency) * a;
        mood.squiggleSpeed += (target.squiggleSpeed - mood.squiggleSpeed) * a;
        mood.r += (target.r - mood.r) * a;
        mood.g += (target.g - mood.g) * a;
        mood.b += (target.b - mood.b) * a;
      }

      if (spinUp.elapsed >= SPIN_UP_DURATION) {
        Object.assign(mood, moods[spinUp.target]);
        sphereExpandRef.current = 1;
        if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = 0;
          parentGroupRef.current.position.z = 0;
        }
        spinUpRef.current = null;
      }
    } else {
      // --- Normal mode ---
      const target = moods[targetRef.current];
      const alpha = 1 - Math.exp(-LERP_SPEED * delta);
      lerpMood(mood, target, alpha);
      helixRotationRef.current += mood.helixSpin * delta * 60;

      // sphereExpand tracks morphProgress in normal mode
      const expandTarget = mood.morphProgress > 0.5 ? 1 : 0;
      sphereExpandRef.current += (expandTarget - sphereExpandRef.current) * alpha;

      const morph = mood.morphProgress;
      setTubeVisible(1 - morph);
      setLinesVisible(morph);
    }

    const time = state.clock.elapsedTime;
    const morph = mood.morphProgress;
    const expand = sphereExpandRef.current;

    // Keep the helix tube — the only visible element while "starting" — in sync
    // with the mood color so baseColor / theme changes are actually reflected.
    helixMaterial.color.setRGB(mood.r, mood.g, mood.b);

    const camDir = cameraDirection.copy(state.camera.position).normalize();

    // During spin-up: kill spin quickly before group unwind (at morph≈0.2)
    // During normal transitions: spin fades linearly with morph
    const spinFade = spinUpRef.current ? Math.max(0, 1 - morph * 5) : 1 - morph;
    if (spinGroupRef.current) {
      spinGroupRef.current.rotation.x = helixRotationRef.current * spinFade;
    }

    // --- Update line geometry ---
    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
      const group = groupRefs.current[lineIdx];
      if (!group) continue;

      const lineConst = lineConstants[lineIdx];
      if (!lineConst) continue;
      const { longitudeRotation } = lineConst;

      // Longitude spread: 0 when circle (expand=0), full when sphere
      const groupRotY = longitudeRotation * morph * expand;
      group.rotation.y = groupRotY;

      const cosRotY = Math.cos(groupRotY);
      const sinRotY = Math.sin(groupRotY);

      // Sphere parameters (for the expanded state)
      const timeOffset = (lineIdx / NUM_LINES) * mood.speed;
      const progress = ((time + timeOffset) % mood.speed) / mood.speed;
      const latitude = progress * Math.PI;

      const sphereR = RADIUS;
      const circleRadius = Math.sin(latitude) * sphereR;
      const yPosition = Math.cos(latitude) * sphereR;

      for (let i = 0; i < POINTS_PER_LINE; i++) {
        const t = i / POINTS_PER_LINE;
        const angle = t * PI2;

        // --- Circle position: yz plane, matches helix cross-section ---
        const cx = 0;
        const cy = Math.cos(angle) * HELIX_AMPLITUDE;
        const cz = Math.sin(angle) * HELIX_AMPLITUDE;

        // --- Sphere position (scaled, with squiggle scaled by expand) ---
        const squiggle =
          Math.sin(angle * mood.squiggleFrequency + time * mood.squiggleSpeed + lineIdx * 0.5) *
          mood.squiggleAmount *
          expand;
        const radiusSquiggle =
          Math.cos(angle * mood.squiggleFrequency * 1.3 + time * mood.squiggleSpeed * 0.8) *
          mood.squiggleAmount *
          0.5 *
          expand;
        const displacedRadius = circleRadius + (squiggle + radiusSquiggle) * circleRadius;
        const ySquiggle =
          Math.sin(angle * mood.squiggleFrequency * 0.7 + time * mood.squiggleSpeed * 1.2) *
          mood.squiggleAmount *
          0.4 *
          expand;

        const sx = Math.cos(angle) * displacedRadius;
        const sy = yPosition + ySquiggle * circleRadius;
        const sz = Math.sin(angle) * displacedRadius;

        // --- Blend circle → sphere based on expand ---
        const tx = cx + (sx - cx) * expand;
        const ty = cy + (sy - cy) * expand;
        const tz = cz + (sz - cz) * expand;

        // --- Blend helix → target based on morph ---
        const hIdx = (lineIdx * POINTS_PER_LINE + i) * 3;
        const hx = helixCache[hIdx] ?? 0;
        const hy = helixCache[hIdx + 1] ?? 0;
        const hz = helixCache[hIdx + 2] ?? 0;

        const x = hx + (tx - hx) * morph;
        const y = hy + (ty - hy) * morph;
        const z = hz + (tz - hz) * morph;

        const offset = i * 3;
        positionBuffer[offset] = x;
        positionBuffer[offset + 1] = y;
        positionBuffer[offset + 2] = z;

        // Depth-based opacity
        const worldX = x * cosRotY + z * sinRotY;
        const worldZ = -x * sinRotY + z * cosRotY;
        const dot = worldX * camDir.x + y * camDir.y + worldZ * camDir.z;
        const depthFactor = (dot / RADIUS + 1) / 2;
        const sphereOpacity = depthFactor * 0.85 + 0.15;
        const opacity = 1 - (1 - sphereOpacity) * morph;

        colorBuffer[offset] = mood.r * opacity;
        colorBuffer[offset + 1] = mood.g * opacity;
        colorBuffer[offset + 2] = mood.b * opacity;
      }

      const last = POINTS_PER_LINE * 3;
      positionBuffer[last] = positionBuffer[0] ?? 0;
      positionBuffer[last + 1] = positionBuffer[1] ?? 0;
      positionBuffer[last + 2] = positionBuffer[2] ?? 0;
      colorBuffer[last] = colorBuffer[0] ?? 0;
      colorBuffer[last + 1] = colorBuffer[1] ?? 0;
      colorBuffer[last + 2] = colorBuffer[2] ?? 0;

      const lineGeom = geometries[lineIdx];
      if (lineGeom) {
        lineGeom.setPositions(positionBuffer);
        lineGeom.setColors(colorBuffer);
      }
    }
  });

  return (
    <group ref={parentGroupRef}>
      <group ref={spinGroupRef}>
        <mesh ref={helixMeshRef} geometry={helixGeometry} material={helixMaterial} />
        {geometries.map((geometry, lineIdx) => {
          const material = materials[lineIdx];
          if (!material) return null;
          return (
            <OrbLine
              // three.js gives each geometry a stable per-instance uuid; safer
              // than the loop index even though the line set is fixed-length.
              key={geometry.uuid}
              lineIdx={lineIdx}
              groupRefs={groupRefs}
              geometry={geometry}
              material={material}
            />
          );
        })}
      </group>
    </group>
  );
}

function OrbLine({
  lineIdx,
  groupRefs,
  geometry,
  material,
}: {
  lineIdx: number;
  groupRefs: React.RefObject<(THREE.Group | null)[]>;
  geometry: LineGeometry;
  material: LineMaterial;
}) {
  const ref = useCallback(
    (el: THREE.Group | null) => {
      groupRefs.current[lineIdx] = el;
    },
    [groupRefs, lineIdx],
  );
  return (
    <group ref={ref}>
      {/* Line2 from three/examples/jsm — registered by the extend() call above
          and typed by the ThreeElements augmentation next to it. */}
      <line2>
        <primitive object={geometry} attach="geometry" />
        <primitive object={material} attach="material" />
      </line2>
    </group>
  );
}

// ---------------------------------------------------------------------------
// GeometricOrb — public component
// ---------------------------------------------------------------------------

export function GeometricOrb({
  status = "idle",
  className = "",
  baseColor = "#eeeeee",
  frameloop = "always",
  lineWidth = DEFAULT_LINE_WIDTH,
  numLines = DEFAULT_NUM_LINES,
}: {
  status?: DisplayStatus;
  className?: string;
  /** Neutral color for idle/starting states; pass a dark value in light mode. */
  baseColor?: string;
  /**
   * R3F render mode. "always" runs useFrame every animation frame (default —
   * used for hero placements). "demand" only paints when state changes —
   * useful when the orb shrinks to a dock-sized status indicator and you
   * don't want a continuous render loop in every shell window.
   */
  frameloop?: "always" | "demand";
  /**
   * Pixel width of each latitude line. The default (2) reads cleanly at
   * hero sizes; drop to ~1.5 when the orb shrinks into a small dock indicator
   * so the strands stay legible instead of dissolving into a blur.
   */
  lineWidth?: number;
  /**
   * Number of latitude strands. Hero placements use the default (20). Smaller
   * placements (dock-sized status indicators) should drop to ~8–12 so the
   * helix→sphere morph reads as individual strands instead of a solid disc.
   */
  numLines?: number;
}) {
  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0, CAMERA_Z], fov: 65 }}
      gl={{ antialias: true, alpha: true }}
      frameloop={frameloop}
    >
      <LatitudeLines
        status={status}
        baseColor={baseColor}
        lineWidth={lineWidth}
        numLines={numLines}
      />
    </Canvas>
  );
}
