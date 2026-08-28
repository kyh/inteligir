import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

import * as THREE from "three";

const PI2 = Math.PI * 2;

// Helix proportions — same shape as reference, scaled to fit camera
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

function HelixTube({ baseColor }: { baseColor: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [geometry] = useState(
    () =>
      new THREE.TubeGeometry(
        new HelixCurve(),
        TUBE_SEGMENTS,
        HELIX_TUBE_RADIUS,
        TUBE_RADIAL_SEGMENTS,
        true,
      ),
  );
  // Painted at the caller's current color so the first frame is not a flash of
  // white; a later theme change lerps rather than cuts.
  const [material] = useState(() => new THREE.MeshBasicMaterial({ color: baseColor }));
  const targetColor = useMemo(() => new THREE.Color(baseColor), [baseColor]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_state, delta) => {
    material.color.lerp(targetColor, 1 - Math.exp(-COLOR_LERP_SPEED * delta));
    if (meshRef.current) {
      meshRef.current.rotation.x += SPIN_RADIANS_PER_FRAME * delta * 60;
    }
  });

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}

export function GeometricOrb({
  baseColor = "#eeeeee",
}: {
  /** Color of the helix; pass a dark value in light mode. */
  baseColor?: string;
}) {
  return (
    <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: 65 }} gl={{ antialias: true, alpha: true }}>
      <HelixTube baseColor={baseColor} />
    </Canvas>
  );
}
