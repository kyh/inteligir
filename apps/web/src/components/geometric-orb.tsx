import { useEffect, useEffectEvent, useRef } from "react";

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

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  readonly #length: number;
  readonly #amplitude: number;

  constructor(length: number, amplitude: number) {
    super();
    this.#length = length;
    this.#amplitude = amplitude;
  }

  override getPoint(percent: number): THREE.Vector3 {
    const x = this.#length * Math.sin(PI2 * percent);
    const y = this.#amplitude * Math.cos(PI2 * 3 * percent);

    const quarter = percent % 0.25;
    const tNorm = quarter / 0.25;
    const segment = Math.floor(percent / 0.25);
    let t = quarter - (2 * (1 - tNorm) * tNorm * -0.0185 + tNorm * tNorm * 0.25);
    if (segment === 0 || segment === 2) {
      t *= -1;
    }
    const z = this.#amplitude * Math.sin(PI2 * 2 * (percent - t));

    return new THREE.Vector3(x, y, z);
  }
}

const HELIX = new HelixCurve(HELIX_LENGTH, HELIX_AMPLITUDE);

// three throws where WebGL is off by policy, missing on a machine with no GPU, or out of contexts,
// and the home page must stand without its orb
const makeRenderer = (): THREE.WebGLRenderer | null => {
  try {
    return new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return null;
  }
};

const mountOrb = (host: HTMLElement, color: string) => {
  const renderer = makeRenderer();
  if (renderer === null) {
    return null;
  }
  // the hero's two greys are chosen under this curve, which draws each darker than its hex
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.className = "block";
  host.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(65);
  camera.position.z = CAMERA_Z;
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(HELIX, TUBE_SEGMENTS, HELIX_TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, true),
    material,
  );
  const scene = new THREE.Scene().add(mesh);
  const wanted = new THREE.Color(color);
  const timer = new THREE.Timer();
  const reducedMotion = window.matchMedia(REDUCED_MOTION);

  const spin = (time: number) => {
    timer.update(time);
    material.color.lerp(wanted, 1 - Math.exp(-COLOR_LERP_SPEED * timer.getDelta()));
    mesh.rotation.x += SPIN_RADIANS_PER_FRAME * timer.getDelta() * 60;
    renderer.render(scene, camera);
  };
  // a still orb draws only when asked, so it takes a theme switch at once rather than a tween
  const rest = () => {
    material.color.copy(wanted);
    renderer.render(scene, camera);
  };
  const run = () => {
    if (reducedMotion.matches) {
      renderer.setAnimationLoop(null);
      rest();
    } else {
      // the time spent still is no frame's delta
      timer.reset();
      renderer.setAnimationLoop(spin);
    }
  };
  const fit = () => {
    renderer.setPixelRatio(THREE.MathUtils.clamp(window.devicePixelRatio, 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };

  const sizes = new ResizeObserver(fit);
  sizes.observe(host);
  reducedMotion.addEventListener("change", run);
  run();

  return {
    dispose: () => {
      sizes.disconnect();
      reducedMotion.removeEventListener("change", run);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
    paint: (next: string) => {
      wanted.set(next);
      if (reducedMotion.matches) {
        rest();
      }
    },
  };
};

export const GeometricOrb = ({ baseColor = "#eeeeee" }: { baseColor?: string }) => {
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<ReturnType<typeof mountOrb>>(null);
  const mount = useEffectEvent((element: HTMLElement) => mountOrb(element, baseColor));

  useEffect(() => {
    if (!host.current) {
      return;
    }
    const mounted = mount(host.current);
    orb.current = mounted;
    return mounted?.dispose;
  }, []);

  useEffect(() => {
    orb.current?.paint(baseColor);
  }, [baseColor]);

  return <div ref={host} className="size-full" />;
};
