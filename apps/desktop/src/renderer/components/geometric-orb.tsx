import { useRef, useMemo, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree, extend } from "@react-three/fiber";

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

import type { SessionStatus } from "@/shared/agent";

extend({ Line2, LineMaterial, LineGeometry });

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const NUM_LINES = 20;
const RADIUS = 1.5;
const POINTS_PER_LINE = 96;
const LINE_WIDTH = 2;
const BACKGROUND = "#d1684e";
const INITIAL_COLOR_INT = new THREE.Color("#eeeeee").getHex();
const PI2 = Math.PI * 2;

// Helix proportions — match reference (length=30, radius=5.6, tubeRadius=1.1)
const HELIX_LENGTH = RADIUS * (30 / 5.6);
const HELIX_AMPLITUDE = RADIUS;
const HELIX_TUBE_RADIUS = HELIX_AMPLITUDE * (1.1 / 5.6);

// Camera
const CAMERA_Z_HELIX = 18;
const CAMERA_Z_SPHERE = 5;
const CAMERA_Y_SPHERE = 0;

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

const moods: Record<SessionStatus, Mood> = {
  idle: {
    speed: 20,
    squiggleAmount: 0.04,
    squiggleFrequency: 4,
    squiggleSpeed: 2,
    morphProgress: 1,
    helixSpin: 0,
    ...rgb("#eeeeee"),
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
    ...rgb("#ffffff"),
  },
};

function rgb(hex: string): { r: number; g: number; b: number } {
  tmpColor.set(hex);
  return { r: tmpColor.r, g: tmpColor.g, b: tmpColor.b };
}

const LERP_SPEED = 3;

// Spin-up phase durations (seconds)
const ACCEL_DURATION = 2.5;
const MORPH_DURATION = 1.5;
const SPIN_UP_DURATION = ACCEL_DURATION + MORPH_DURATION;

/**
 * Reference easing — quadratic ease-in, cubic ease-out.
 * Original: if((t/=d/2)<1)return c/2*t*t+b;return c/2*((t-=2)*t*t+2)+b;
 */
function referenceEasing(t: number): number {
  const u = t * 2;
  if (u < 1) return 0.5 * u * u;
  const s = u - 2;
  return 0.5 * (s * s * s + 2);
}

/** Cubic ease-in-out for morph phase */
function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerpMood(current: Mood, target: Mood, alpha: number): void {
  current.speed += (target.speed - current.speed) * alpha;
  current.squiggleAmount +=
    (target.squiggleAmount - current.squiggleAmount) * alpha;
  current.squiggleFrequency +=
    (target.squiggleFrequency - current.squiggleFrequency) * alpha;
  current.squiggleSpeed +=
    (target.squiggleSpeed - current.squiggleSpeed) * alpha;
  current.morphProgress +=
    (target.morphProgress - current.morphProgress) * alpha;
  current.helixSpin += (target.helixSpin - current.helixSpin) * alpha;
  current.r += (target.r - current.r) * alpha;
  current.g += (target.g - current.g) * alpha;
  current.b += (target.b - current.b) * alpha;
}

// ---------------------------------------------------------------------------
// Helix curve — identical to reference
// ---------------------------------------------------------------------------

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  getPoint(percent: number): THREE.Vector3 {
    const x = HELIX_LENGTH * Math.sin(PI2 * percent);
    const y = HELIX_AMPLITUDE * Math.cos(PI2 * 3 * percent);

    const quarter = percent % 0.25;
    const tNorm = quarter / 0.25;
    const segment = Math.floor(percent / 0.25);
    let t =
      quarter - (2 * (1 - tNorm) * tNorm * -0.0185 + tNorm * tNorm * 0.25);
    if (segment === 0 || segment === 2) {
      t *= -1;
    }
    const z = HELIX_AMPLITUDE * Math.sin(PI2 * 2 * (percent - t));

    return new THREE.Vector3(x, y, z);
  }
}

function helixPoint(
  percent: number,
  tubeAngle: number,
): [number, number, number] {
  const x = HELIX_LENGTH * Math.sin(PI2 * percent);
  const y = HELIX_AMPLITUDE * Math.cos(PI2 * 3 * percent);

  const quarter = percent % 0.25;
  const tNorm = quarter / 0.25;
  const segment = Math.floor(percent / 0.25);
  let t =
    quarter - (2 * (1 - tNorm) * tNorm * -0.0185 + tNorm * tNorm * 0.25);
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

function LatitudeLines({ status }: { status: SessionStatus }) {
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const parentGroupRef = useRef<THREE.Group>(null);
  const spinGroupRef = useRef<THREE.Group>(null);
  const camDirRef = useRef(new THREE.Vector3());
  const helixRotationRef = useRef(0);
  const { size } = useThree();

  const moodRef = useRef<Mood>({ ...moods[status] });
  const targetRef = useRef(status);
  const prevStatusRef = useRef(status);
  const spinUpRef = useRef<{
    elapsed: number;
    target: SessionStatus;
  } | null>(null);

  if (status !== prevStatusRef.current) {
    if (prevStatusRef.current === "starting" && status !== "starting") {
      spinUpRef.current = { elapsed: 0, target: status };
    }
    prevStatusRef.current = status;
  }
  targetRef.current = status;

  // --- Tube mesh (reference: TubeGeometry(curve, 200, 1.1, 2, true)) ---
  const helixMeshRef = useRef<THREE.Mesh>(null);
  const helixGeometry = useMemo(
    () =>
      new THREE.TubeGeometry(
        new HelixCurve(),
        200,
        HELIX_TUBE_RADIUS,
        2,
        true,
      ),
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

  // --- Sphere line constants ---
  const lineConstants = useMemo(
    () =>
      Array.from({ length: NUM_LINES }, (_, i) => ({
        longitudeRotation: (i / NUM_LINES) * Math.PI,
        tubeAngle: (i / NUM_LINES) * PI2,
      })),
    [],
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
  }, []);

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
  const positionBuffer = useMemo(
    () => new Float32Array(vertexCount * 3),
    [vertexCount],
  );
  const colorBuffer = useMemo(
    () => new Float32Array(vertexCount * 3),
    [vertexCount],
  );

  // -----------------------------------------------------------------------
  // useFrame — animation loop
  // -----------------------------------------------------------------------

  useFrame((state, delta) => {
    const mood = moodRef.current;
    const spinUp = spinUpRef.current;

    // --- Visibility helpers ---
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

    // --- Spin-up transition (starting → other) ---
    if (spinUp) {
      spinUp.elapsed += delta;

      if (spinUp.elapsed <= ACCEL_DURATION) {
        // Acceleration phase — helix spins faster + turns
        const normalizedTime = Math.min(
          spinUp.elapsed / ACCEL_DURATION,
          1,
        );
        const acceleration = referenceEasing(normalizedTime);

        // Reference: mesh.rotation.x += rotatevalue + acceleration
        helixRotationRef.current +=
          (ROTATE_VALUE + acceleration) * delta * 60;
        mood.morphProgress = 0;

        // Turn + push only when acceleration > 0.35
        if (acceleration > 0.35) {
          const progress = (acceleration - 0.35) / 0.65;
          if (parentGroupRef.current) {
            parentGroupRef.current.rotation.y = (-Math.PI / 2) * progress;
            parentGroupRef.current.position.z = 6 * progress;
          }
        } else if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = 0;
          parentGroupRef.current.position.z = 0;
        }

        setTubeVisible(1);
        setLinesVisible(0);

        // Color lerp
        const target = moods[spinUp.target];
        const a = acceleration * 0.05;
        mood.r += (target.r - mood.r) * a;
        mood.g += (target.g - mood.g) * a;
        mood.b += (target.b - mood.b) * a;
      } else {
        // Morph phase — tube → sphere with Z-roll
        const morphElapsed = spinUp.elapsed - ACCEL_DURATION;
        const step = Math.min(morphElapsed / MORPH_DURATION, 1);
        const eased = easeInOutCubic(step);

        // Decelerate spin
        helixRotationRef.current +=
          (ROTATE_VALUE + 1) * (1 - eased) * delta * 60;
        mood.morphProgress = eased;

        // Unwind group rotation + position
        if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = (-Math.PI / 2) * (1 - eased);
          parentGroupRef.current.position.z = 6 * (1 - eased);
        }

        // Z-roll smooths the helix→sphere transition
        if (spinGroupRef.current) {
          spinGroupRef.current.rotation.z = Math.PI * eased;
        }

        // Crossfade tube → lines
        setTubeVisible(1 - eased);
        setLinesVisible(eased);

        // Lerp remaining params toward target
        const target = moods[spinUp.target];
        const a = eased * 0.1;
        mood.speed += (target.speed - mood.speed) * a;
        mood.squiggleAmount +=
          (target.squiggleAmount - mood.squiggleAmount) * a;
        mood.squiggleFrequency +=
          (target.squiggleFrequency - mood.squiggleFrequency) * a;
        mood.squiggleSpeed +=
          (target.squiggleSpeed - mood.squiggleSpeed) * a;
        mood.r += (target.r - mood.r) * a;
        mood.g += (target.g - mood.g) * a;
        mood.b += (target.b - mood.b) * a;
      }

      if (spinUp.elapsed >= SPIN_UP_DURATION) {
        Object.assign(mood, moods[spinUp.target]);
        if (parentGroupRef.current) {
          parentGroupRef.current.rotation.y = 0;
          parentGroupRef.current.position.z = 0;
        }
        if (spinGroupRef.current) {
          spinGroupRef.current.rotation.z = 0;
        }
        spinUpRef.current = null;
      }
    } else {
      // --- Normal mode ---
      const target = moods[targetRef.current];
      const alpha = 1 - Math.exp(-LERP_SPEED * delta);
      lerpMood(mood, target, alpha);

      // Accumulate rotation from mood (frame-rate independent)
      helixRotationRef.current += mood.helixSpin * delta * 60;

      const morph = mood.morphProgress;
      setTubeVisible(1 - morph);
      setLinesVisible(morph);
    }

    const time = state.clock.elapsedTime;
    const morph = mood.morphProgress;

    // --- Camera ---
    state.camera.position.z =
      CAMERA_Z_HELIX + (CAMERA_Z_SPHERE - CAMERA_Z_HELIX) * morph;
    state.camera.position.y = CAMERA_Y_SPHERE * morph;

    const camDir = camDirRef.current.copy(state.camera.position).normalize();

    // --- Apply spin rotation (fades out as morph→1) ---
    if (spinGroupRef.current) {
      spinGroupRef.current.rotation.x =
        helixRotationRef.current * (1 - morph);
    }

    // --- Update sphere line geometry ---
    for (let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++) {
      const group = groupRefs.current[lineIdx];
      if (!group) continue;

      const { longitudeRotation } = lineConstants[lineIdx];

      const groupRotY = longitudeRotation * morph;
      group.rotation.y = groupRotY;

      const cosRotY = Math.cos(groupRotY);
      const sinRotY = Math.sin(groupRotY);

      const timeOffset = (lineIdx / NUM_LINES) * mood.speed;
      const progress = ((time + timeOffset) % mood.speed) / mood.speed;
      const latitude = progress * Math.PI;
      const circleRadius = Math.sin(latitude) * RADIUS;
      const yPosition = Math.cos(latitude) * RADIUS;

      for (let i = 0; i < POINTS_PER_LINE; i++) {
        const t = i / POINTS_PER_LINE;
        const angle = t * PI2;

        const squiggle =
          Math.sin(
            angle * mood.squiggleFrequency +
              time * mood.squiggleSpeed +
              lineIdx * 0.5,
          ) * mood.squiggleAmount;
        const radiusSquiggle =
          Math.cos(
            angle * mood.squiggleFrequency * 1.3 +
              time * mood.squiggleSpeed * 0.8,
          ) *
          mood.squiggleAmount *
          0.5;
        const displacedRadius =
          circleRadius + (squiggle + radiusSquiggle) * circleRadius;
        const ySquiggle =
          Math.sin(
            angle * mood.squiggleFrequency * 0.7 +
              time * mood.squiggleSpeed * 1.2,
          ) *
          mood.squiggleAmount *
          0.4;

        const sx = Math.cos(angle) * displacedRadius;
        const sy = yPosition + ySquiggle * circleRadius;
        const sz = Math.sin(angle) * displacedRadius;

        const hIdx = (lineIdx * POINTS_PER_LINE + i) * 3;
        const hx = helixCache[hIdx];
        const hy = helixCache[hIdx + 1];
        const hz = helixCache[hIdx + 2];

        const x = hx + (sx - hx) * morph;
        const y = hy + (sy - hy) * morph;
        const z = hz + (sz - hz) * morph;

        const offset = i * 3;
        positionBuffer[offset] = x;
        positionBuffer[offset + 1] = y;
        positionBuffer[offset + 2] = z;

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
      positionBuffer[last] = positionBuffer[0];
      positionBuffer[last + 1] = positionBuffer[1];
      positionBuffer[last + 2] = positionBuffer[2];
      colorBuffer[last] = colorBuffer[0];
      colorBuffer[last + 1] = colorBuffer[1];
      colorBuffer[last + 2] = colorBuffer[2];

      geometries[lineIdx].setPositions(positionBuffer);
      geometries[lineIdx].setColors(colorBuffer);
    }
  });

  return (
    <group ref={parentGroupRef}>
      <group ref={spinGroupRef}>
        <mesh
          ref={helixMeshRef}
          geometry={helixGeometry}
          material={helixMaterial}
        />
        {Array.from({ length: NUM_LINES }, (_, lineIdx) => (
          <OrbLine
            key={lineIdx}
            lineIdx={lineIdx}
            groupRefs={groupRefs}
            geometry={geometries[lineIdx]}
            material={materials[lineIdx]}
          />
        ))}
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
  groupRefs: React.MutableRefObject<(THREE.Group | null)[]>;
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
    <Canvas
      className={className}
      camera={{
        position: [
          0,
          CAMERA_Y_SPHERE * moods[status].morphProgress,
          CAMERA_Z_HELIX +
            (CAMERA_Z_SPHERE - CAMERA_Z_HELIX) *
              moods[status].morphProgress,
        ],
        fov: 65,
      }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[BACKGROUND]} />
      <LatitudeLines status={status} />
    </Canvas>
  );
}
