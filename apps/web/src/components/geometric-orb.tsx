import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

import * as THREE from "three";

const PI2 = Math.PI * 2;

const HELIX_LENGTH = 2.8;
const HELIX_AMPLITUDE = HELIX_LENGTH * (5.6 / 30);
const HELIX_TUBE_RADIUS = HELIX_AMPLITUDE * (1.1 / 5.6);
const TUBE_SEGMENTS = 200;
const TUBE_RADIAL_SEGMENTS = 2;

const CAMERA_Z = 5;

const SPIN_RADIANS_PER_FRAME = 0.035;
const COLOR_LERP_SPEED = 3;

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  // eslint-disable-next-line no-useless-constructor -- exposes protected base constructor
  constructor() {
    super();
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- THREE.Curve declares getPoint as an instance method; a static one would not override it
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

const HELIX = new HelixCurve();

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
};

const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

const HelixTube = ({ baseColor, still }: { baseColor: string; still: boolean }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const painted = useRef(false);
  const targetColor = useMemo(() => new THREE.Color(baseColor), [baseColor]);
  const invalidate = useThree((state) => state.invalidate);

  // a still canvas draws only when asked, one frame per ask, so it takes a theme switch at once rather than a tween
  useEffect(() => {
    if (still) {
      materialRef.current?.color.copy(targetColor);
      invalidate();
    }
  }, [invalidate, still, targetColor]);

  useFrame((_state, delta) => {
    // the first frame takes the color outright: a lerp would open on the material's default white
    const step = painted.current ? 1 - Math.exp(-COLOR_LERP_SPEED * delta) : 1;
    materialRef.current?.color.lerp(targetColor, step);
    painted.current = true;
    if (!still && meshRef.current) {
      meshRef.current.rotation.x += SPIN_RADIANS_PER_FRAME * delta * 60;
    }
  });

  return (
    <mesh ref={meshRef}>
      <tubeGeometry args={[HELIX, TUBE_SEGMENTS, HELIX_TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, true]} />
      <meshBasicMaterial ref={materialRef} />
    </mesh>
  );
};

export const GeometricOrb = ({ baseColor = "#eeeeee" }: { baseColor?: string }) => {
  const still = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion);
  return (
    <Canvas
      camera={{ fov: 65, position: [0, 0, CAMERA_Z] }}
      frameloop={still ? "demand" : "always"}
      gl={{ alpha: true, antialias: true }}
    >
      <HelixTube baseColor={baseColor} still={still} />
    </Canvas>
  );
};
