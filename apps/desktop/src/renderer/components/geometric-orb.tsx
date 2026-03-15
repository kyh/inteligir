import { useRef, useMemo, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree, extend } from "@react-three/fiber";

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

import type { SessionStatus } from "@/shared/agent";

extend({ Line2, LineMaterial, LineGeometry });

// ---------------------------------------------------------------------------
// Static config (never changes at runtime)
// ---------------------------------------------------------------------------

const NUM_LINES = 20;
const RADIUS = 1.5;
const POINTS_PER_LINE = 96;
const LINE_WIDTH = 2;
const BACKGROUND = "#0a0a0a";
const INITIAL_COLOR_INT = new THREE.Color("#eeeeee").getHex();

// ---------------------------------------------------------------------------
// Dynamic parameters — interpolated per-frame toward the active mood
// ---------------------------------------------------------------------------

type Mood = {
  speed: number;
  squiggleAmount: number;
  squiggleFrequency: number;
  squiggleSpeed: number;
  r: number;
  g: number;
  b: number;
};

const tmpColor = new THREE.Color();

const moods: Record<SessionStatus, Mood> = {
  idle: {
    speed: 20,
    squiggleAmount: 0.04,
    squiggleFrequency: 4,
    squiggleSpeed: 2,
    ...rgb("#eeeeee"),
  },
  busy: {
    speed: 10,
    squiggleAmount: 0.08,
    squiggleFrequency: 6,
    squiggleSpeed: 5,
    ...rgb("#66bbff"),
  },
  error: {
    speed: 14,
    squiggleAmount: 0.12,
    squiggleFrequency: 8,
    squiggleSpeed: 7,
    ...rgb("#ff6666"),
  },
  starting: {
    speed: 25,
    squiggleAmount: 0.02,
    squiggleFrequency: 3,
    squiggleSpeed: 1,
    ...rgb("#888888"),
  },
};

function rgb(hex: string): { r: number; g: number; b: number } {
  tmpColor.set(hex);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b };
}

/** Lerp factor per second — higher = snappier transitions */
const LERP_SPEED = 3;

function lerpMood(current: Mood, target: Mood, alpha: number): void {
  current.speed += (target.speed - current.speed) * alpha;
  current.squiggleAmount += (target.squiggleAmount - current.squiggleAmount) * alpha;
  current.squiggleFrequency += (target.squiggleFrequency - current.squiggleFrequency) * alpha;
  current.squiggleSpeed += (target.squiggleSpeed - current.squiggleSpeed) * alpha;
  current.r += (target.r - current.r) * alpha;
  current.g += (target.g - current.g) * alpha;
  current.b += (target.b - current.b) * alpha;
}

// ---------------------------------------------------------------------------
// LatitudeLines — all lines rendered with a single useFrame callback
// ---------------------------------------------------------------------------

function LatitudeLines({ status }: { status: SessionStatus }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const camDirRef = useRef(new THREE.Vector3());
  const { size } = useThree();

  const moodRef = useRef<Mood>({ ...moods[status] });
  const targetRef = useRef(status);
  targetRef.current = status;

  const lineConstants = useMemo(
    () =>
      Array.from({ length: NUM_LINES }, (_, i) => ({
        longitudeRotation: (i / NUM_LINES) * Math.PI,
        cosR: Math.cos((i / NUM_LINES) * Math.PI),
        sinR: Math.sin((i / NUM_LINES) * Math.PI),
      })),
    [],
  );

  const materials = useMemo(
    () =>
      Array.from(
        { length: NUM_LINES },
        () =>
          new LineMaterial({
            color: INITIAL_COLOR_INT,
            linewidth: LINE_WIDTH,
            transparent: true,
            opacity: 1,
            vertexColors: true,
          }),
      ),
    [],
  );

  const geometries = useMemo(
    () => Array.from({ length: NUM_LINES }, () => new LineGeometry()),
    [],
  );

  useEffect(() => {
    return () => {
      for (const mat of materials) mat.dispose();
      for (const geo of geometries) geo.dispose();
    };
  }, [materials, geometries]);

  useEffect(() => {
    for (const mat of materials) {
      mat.resolution.set(size.width, size.height);
    }
  }, [materials, size.width, size.height]);

  const vertexCount = POINTS_PER_LINE + 1;
  const positionBuffer = useMemo(() => new Float32Array(vertexCount * 3), [vertexCount]);
  const colorBuffer = useMemo(() => new Float32Array(vertexCount * 3), [vertexCount]);

  useFrame((state, delta) => {
    // Smooth interpolation toward target mood
    const target = moods[targetRef.current];
    const alpha = 1 - Math.exp(-LERP_SPEED * delta);
    lerpMood(moodRef.current, target, alpha);

    const mood = moodRef.current;
    const time = state.clock.elapsedTime;
    const camDir = camDirRef.current.copy(state.camera.position).normalize();

    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
      const group = groupRefs.current[lineIdx];
      if (!group) continue;

      const { longitudeRotation, cosR, sinR } = lineConstants[lineIdx];
      const timeOffset = (lineIdx / NUM_LINES) * mood.speed;
      const progress = ((time + timeOffset) % mood.speed) / mood.speed;
      const latitude = progress * Math.PI;
      const circleRadius = Math.sin(latitude) * RADIUS;
      const yPosition = Math.cos(latitude) * RADIUS;

      for (let i = 0; i < POINTS_PER_LINE; i++) {
        const angle = (i / POINTS_PER_LINE) * Math.PI * 2;
        const squiggle =
          Math.sin(angle * mood.squiggleFrequency + time * mood.squiggleSpeed + lineIdx * 0.5) *
          mood.squiggleAmount;
        const radiusSquiggle =
          Math.cos(angle * mood.squiggleFrequency * 1.3 + time * mood.squiggleSpeed * 0.8) *
          mood.squiggleAmount *
          0.5;
        const displacedRadius = circleRadius + (squiggle + radiusSquiggle) * circleRadius;
        const ySquiggle =
          Math.sin(angle * mood.squiggleFrequency * 0.7 + time * mood.squiggleSpeed * 1.2) *
          mood.squiggleAmount *
          0.4;

        const x = Math.cos(angle) * displacedRadius;
        const y = yPosition + ySquiggle * circleRadius;
        const z = Math.sin(angle) * displacedRadius;

        const offset = i * 3;
        positionBuffer[offset] = x;
        positionBuffer[offset + 1] = y;
        positionBuffer[offset + 2] = z;

        const worldX = x * cosR + z * sinR;
        const worldZ = -x * sinR + z * cosR;
        const dot = worldX * camDir.x + y * camDir.y + worldZ * camDir.z;
        const depthFactor = (dot / RADIUS + 1) / 2;
        const opacity = depthFactor * 0.85 + 0.15;

        colorBuffer[offset] = mood.r * opacity;
        colorBuffer[offset + 1] = mood.g * opacity;
        colorBuffer[offset + 2] = mood.b * opacity;
      }

      const last = POINTS_PER_LINE * 3;
      positionBuffer[last] = positionBuffer[0];
      positionBuffer[last + 1] = positionBuffer[1];
      positionBuffer[last + 2] = positionBuffer[2];
      colorBuffer[last] = colorBuffer[0];
      colorBuffer[last + 1] = colorBuffer[1];
      colorBuffer[last + 2] = colorBuffer[2];

      geometries[lineIdx].setPositions(positionBuffer);
      geometries[lineIdx].setColors(colorBuffer);
      group.rotation.y = longitudeRotation;
    }
  });

  return (
    <>
      {Array.from({ length: NUM_LINES }, (_, lineIdx) => (
        <OrbLine
          key={lineIdx}
          lineIdx={lineIdx}
          groupRefs={groupRefs}
          geometry={geometries[lineIdx]}
          material={materials[lineIdx]}
        />
      ))}
    </>
  );
}

function OrbLine({
  lineIdx,
  groupRefs,
  geometry,
  material,
}: {
  lineIdx: number;
  groupRefs: React.MutableRefObject<(THREE.Group | null)[]>;
  geometry: LineGeometry;
  material: LineMaterial;
}) {
  const ref = useCallback(
    (el: THREE.Group | null) => { groupRefs.current[lineIdx] = el; },
    [groupRefs, lineIdx],
  );
  return (
    <group ref={ref}>
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
}: {
  status?: SessionStatus;
  className?: string;
}) {
  return (
    <div className={`h-full w-full ${className}`} style={{ background: BACKGROUND }}>
      <Canvas camera={{ position: [0, 2, 6], fov: 45 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={[BACKGROUND]} />
        <LatitudeLines status={status} />

      </Canvas>
    </div>
  );
}
