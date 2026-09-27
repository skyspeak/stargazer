"use client";

/* The camera and point buffers are Three.js objects updated each frame. */
/* eslint-disable react-hooks/immutability */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  DEG,
  J2000_JD,
  RAD,
  altAzToVector,
  colorFromBV,
  galacticToEquatorial,
  julianDate,
  localSiderealHours,
  precess,
  raDecToAltAz,
  starPointSize,
  type PlacedStar,
  type Vec3,
} from "@/lib/astro";
import { constellationInfo } from "@/lib/constellations";
import { skyLines } from "@/lib/catalog";

const STAR_R = 20;
const DOME_R = 70;

export type ViewState = {
  az: number;
  alt: number;
  fov: number;
  up: Vec3 | null;
};

export type ScreenLabel = {
  code: string;
  name: string;
  x: number;
  y: number;
};

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aSize * uScale);
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float d = length(p);
    if (d > 0.5) discard;
    float core = smoothstep(0.18, 0.0, d);
    float glow = smoothstep(0.5, 0.12, d);
    float alpha = vAlpha * (0.28 * glow + 0.92 * core);
    gl_FragColor = vec4(vColor, alpha);
  }
`;

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const domeFragment = /* glsl */ `
  varying vec3 vDir;
  void main() {
    float alt = vDir.y;
    vec3 zenith = vec3(0.015, 0.028, 0.07);
    vec3 horizon = vec3(0.10, 0.125, 0.20);
    vec3 ground = vec3(0.012, 0.013, 0.016);
    vec3 glow = vec3(0.55, 0.38, 0.18);
    vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.62, alt));
    sky += glow * exp(-pow(alt / 0.028, 2.0)) * 0.5;
    gl_FragColor = vec4(mix(sky, ground, smoothstep(0.012, -0.12, alt)), 1.0);
  }
`;

function horizonFade(alt: number) {
  if (alt >= 0) return 1;
  if (alt <= -8) return 0;
  return ((alt + 8) / 8) * 0.4;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type MilkyPoint = { ra: number; dec: number; w: number };

function buildMilkyWay(): MilkyPoint[] {
  const rand = mulberry32(0x51a7);
  const pts: MilkyPoint[] = [];
  for (let i = 0; i < 5200; i++) {
    const l = rand() * 360;
    const b = (rand() + rand() + rand() - 1.5) * 16;
    const wrap = Math.min(l, 360 - l);
    const weight =
      Math.exp(-0.5 * (b / 6.5) ** 2) * (0.28 + 0.85 * Math.exp(-(wrap * wrap) / (2 * 40 * 40)));
    if (rand() > weight) continue;
    const eq = galacticToEquatorial(l, b);
    pts.push({ ra: eq.ra, dec: eq.dec, w: 0.14 + weight * 0.4 });
  }
  return pts;
}

const MILKY = buildMilkyWay();

function makeCompassTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.font = "600 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(228, 181, 106, 0.92)";
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function LookController({
  viewRef,
  dragEnabled,
  placed,
  onPick,
}: {
  viewRef: React.MutableRefObject<ViewState>;
  dragEnabled: boolean;
  placed: PlacedStar[];
  onPick: (hr: number | null) => void;
}) {
  const { camera, gl, size } = useThree();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; fov: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.07 : 0.935;
      viewRef.current.fov = Math.min(100, Math.max(14, viewRef.current.fov * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, viewRef]);

  useEffect(() => {
    const el = gl.domElement;
    const onDown = (event: PointerEvent) => {
      if (!dragEnabled) return;
      el.setPointerCapture(event.pointerId);
      const rect = el.getBoundingClientRect();
      pointers.current.set(event.pointerId, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      drag.current = { x: event.clientX, y: event.clientY, moved: 0 };
      if (pointers.current.size === 2) {
        const [p, q] = [...pointers.current.values()];
        pinch.current = { dist: Math.hypot(p.x - q.x, p.y - q.y), fov: viewRef.current.fov };
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return;
      const rect = el.getBoundingClientRect();
      pointers.current.set(event.pointerId, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      if (pointers.current.size === 2 && pinch.current && pinch.current.dist > 8) {
        const [p, q] = [...pointers.current.values()];
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        viewRef.current.fov = Math.min(100, Math.max(14, pinch.current.fov * (pinch.current.dist / dist)));
        return;
      }
      if (!drag.current || !dragEnabled) return;
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      drag.current.moved += Math.abs(dx) + Math.abs(dy);
      const fovY = viewRef.current.fov;
      const fovX = 2 * Math.atan(Math.tan((fovY * DEG) / 2) * (size.width / Math.max(1, size.height))) * RAD;
      const cosAlt = Math.max(0.22, Math.cos(viewRef.current.alt * DEG));
      viewRef.current.az = (viewRef.current.az + (dx * (fovX / size.width)) / cosAlt + 360) % 360;
      viewRef.current.alt = Math.max(-28, Math.min(88, viewRef.current.alt - dy * (fovY / Math.max(1, size.height))));
      viewRef.current.up = null;
    };
    const onUp = (event: PointerEvent) => {
      const moved = drag.current?.moved ?? 0;
      pointers.current.delete(event.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      drag.current = null;
      if (moved >= 6 || !dragEnabled) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const dir = raycaster.ray.direction;
      const limit = Math.cos(Math.max(1.1, viewRef.current.fov * 0.018) * DEG);
      let bestHr: number | null = null;
      let best = limit;
      for (const star of placed) {
        if (star.alt < -1) continue;
        const dot = dir.x * star.dir.x + dir.y * star.dir.y + dir.z * star.dir.z;
        if (dot > best) {
          best = dot;
          bestHr = star.hr;
        }
      }
      onPick(bestHr);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [camera, dragEnabled, gl, onPick, placed, size.height, size.width, viewRef]);

  useFrame(() => {
    const view = viewRef.current;
    const dir = altAzToVector(view.alt, view.az);
    const up = view.up ?? { x: 0, y: 1, z: 0 };
    let ux = up.x;
    let uy = up.y;
    let uz = up.z;
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen;
    uy /= ulen;
    uz /= ulen;
    if (Math.abs(ux * dir.x + uy * dir.y + uz * dir.z) > 0.98) {
      ux = 0;
      uy = 1;
      uz = 0;
    }
    camera.position.set(0, 0, 0);
    camera.up.set(ux, uy, uz);
    camera.lookAt(dir.x, dir.y, dir.z);
    const persp = camera as THREE.PerspectiveCamera;
    if (Math.abs(persp.fov - view.fov) > 0.05) {
      persp.fov = view.fov;
      persp.updateProjectionMatrix();
    }
  });

  return null;
}

function StarField({
  placed,
  showLines,
  showLabels,
  selected,
  onLabels,
}: {
  placed: PlacedStar[];
  showLines: boolean;
  showLabels: boolean;
  selected: PlacedStar | null;
  onLabels: (labels: ScreenLabel[]) => void;
}) {
  const { camera, size } = useThree();
  const starMat = useRef<THREE.ShaderMaterial>(null);
  const lastLabel = useRef(0);

  const stars = useMemo(() => {
    const positions = new Float32Array(placed.length * 3);
    const colors = new Float32Array(placed.length * 3);
    const sizes = new Float32Array(placed.length);
    const alphas = new Float32Array(placed.length);
    placed.forEach((star, i) => {
      const fade = horizonFade(star.alt);
      positions[i * 3] = star.dir.x * STAR_R;
      positions[i * 3 + 1] = star.dir.y * STAR_R;
      positions[i * 3 + 2] = star.dir.z * STAR_R;
      const [r, g, b] = colorFromBV(star.bv);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      sizes[i] = fade === 0 ? 0 : starPointSize(star.mag);
      alphas[i] = Math.max(0.34, Math.min(1, 1.08 - star.mag * 0.11)) * fade;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geo;
  }, [placed]);

  const lines = useMemo(() => {
    const byHr = new Map(placed.map((star) => [star.hr, star]));
    const positions: number[] = [];
    for (const [a, b] of skyLines) {
      const sa = byHr.get(a);
      const sb = byHr.get(b);
      if (!sa || !sb) continue;
      if ((sa.alt + sb.alt) / 2 < -1.2) continue;
      positions.push(sa.dir.x * STAR_R, sa.dir.y * STAR_R, sa.dir.z * STAR_R, sb.dir.x * STAR_R, sb.dir.y * STAR_R, sb.dir.z * STAR_R);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [placed]);

  const centroids = useMemo(() => {
    const groups = new Map<string, Vec3[]>();
    for (const star of placed) {
      if (star.alt < 1) continue;
      const list = groups.get(star.con) ?? [];
      list.push(star.dir);
      groups.set(star.con, list);
    }
    const out: { code: string; name: string; dir: THREE.Vector3 }[] = [];
    for (const [code, dirs] of groups) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const dir of dirs) {
        x += dir.x;
        y += dir.y;
        z += dir.z;
      }
      const len = Math.hypot(x, y, z) || 1;
      if (y / len < 0.04) continue;
      out.push({
        code,
        name: constellationInfo(code).name,
        dir: new THREE.Vector3(x / len, y / len, z / len),
      });
    }
    return out;
  }, [placed]);

  useEffect(() => {
    return () => {
      stars.dispose();
      lines.dispose();
    };
  }, [lines, stars]);

  useFrame(({ clock }) => {
    if (starMat.current) {
      const fov = (camera as THREE.PerspectiveCamera).fov || 62;
      starMat.current.uniforms.uScale.value = (64 / fov) * Math.min(2, window.devicePixelRatio);
    }
    if (clock.elapsedTime - lastLabel.current < 0.08) return;
    lastLabel.current = clock.elapsedTime;
    if (!showLabels) {
      onLabels([]);
      return;
    }
    const look = new THREE.Vector3();
    camera.getWorldDirection(look);
    const labels: ScreenLabel[] = [];
    for (const mark of centroids) {
      if (look.dot(mark.dir) < 0.2) continue;
      const projected = mark.dir.clone().multiplyScalar(STAR_R).project(camera);
      const x = (projected.x * 0.5 + 0.5) * size.width;
      const y = (-projected.y * 0.5 + 0.5) * size.height;
      if (x < -30 || y < -16 || x > size.width + 30 || y > size.height + 16) continue;
      labels.push({ code: mark.code, name: mark.name, x, y });
    }
    onLabels(labels);
  });

  return (
    <>
      <points geometry={stars} frustumCulled={false}>
        <shaderMaterial
          ref={starMat}
          glslVersion={THREE.GLSL1}
          vertexShader={starVertex}
          fragmentShader={starFragment}
          transparent
          depthWrite={false}
          uniforms={{ uScale: { value: 1 } }}
        />
      </points>
      {showLines ? (
        <lineSegments geometry={lines} frustumCulled={false}>
          <lineBasicMaterial color="#b7c7de" transparent opacity={0.45} depthWrite={false} />
        </lineSegments>
      ) : null}
      {selected ? (
        <SelectionRing position={[selected.dir.x * 19.2, selected.dir.y * 19.2, selected.dir.z * 19.2]} />
      ) : null}
    </>
  );
}

function SelectionRing({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    ref.current?.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[0.22, 0.31, 40]} />
      <meshBasicMaterial color="#e4b56a" transparent opacity={0.95} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function MilkyWay({ lat, lon, when }: { lat: number; lon: number; when: Date }) {
  const geo = useMemo(() => {
    const epoch = julianDate(when);
    const lst = localSiderealHours(when, lon);
    const positions = new Float32Array(MILKY.length * 3);
    const colors = new Float32Array(MILKY.length * 3);
    const sizes = new Float32Array(MILKY.length);
    const alphas = new Float32Array(MILKY.length);
    MILKY.forEach((point, i) => {
      const ofDate = precess(point.ra, point.dec, J2000_JD, epoch);
      const { alt, az } = raDecToAltAz(ofDate.ra, ofDate.dec, lat, lst);
      const dir = altAzToVector(alt, az);
      const fade = horizonFade(alt);
      positions[i * 3] = dir.x * (STAR_R + 1.4);
      positions[i * 3 + 1] = dir.y * (STAR_R + 1.4);
      positions[i * 3 + 2] = dir.z * (STAR_R + 1.4);
      colors[i * 3] = 0.55;
      colors[i * 3 + 1] = 0.64;
      colors[i * 3 + 2] = 0.82;
      sizes[i] = 2.4;
      alphas[i] = point.w * fade * 0.55;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    return geometry;
  }, [lat, lon, when]);

  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        glslVersion={THREE.GLSL1}
        vertexShader={starVertex}
        fragmentShader={starFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{ uScale: { value: 1 } }}
      />
    </points>
  );
}

function Dome() {
  return (
    <mesh frustumCulled={false}>
      <sphereGeometry args={[DOME_R, 48, 32]} />
      <shaderMaterial
        glslVersion={THREE.GLSL1}
        vertexShader={domeVertex}
        fragmentShader={domeFragment}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Horizon() {
  const ring = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a) * STAR_R, 0, Math.cos(a) * STAR_R));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const material = new THREE.LineBasicMaterial({
      color: 0xe4b56a,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    return new THREE.Line(geometry, material);
  }, []);
  const marks = useMemo(
    () => ["N", "E", "S", "W"].map((text) => ({ text, map: makeCompassTexture(text) })),
    [],
  );
  const dirs: [number, number, number][] = [
    [0, 0.45, STAR_R],
    [STAR_R, 0.45, 0],
    [0, 0.45, -STAR_R],
    [-STAR_R, 0.45, 0],
  ];
  return (
    <>
      <primitive object={ring} />
      {marks.map((mark, i) => (
        <sprite key={mark.text} position={dirs[i]} scale={[2.8, 1.4, 1]}>
          <spriteMaterial map={mark.map} transparent depthWrite={false} />
        </sprite>
      ))}
    </>
  );
}

function Scene(props: {
  placed: PlacedStar[];
  lat: number;
  lon: number;
  when: Date;
  viewRef: React.MutableRefObject<ViewState>;
  dragEnabled: boolean;
  showLines: boolean;
  showLabels: boolean;
  selected: PlacedStar | null;
  onPick: (hr: number | null) => void;
  onLabels: (labels: ScreenLabel[]) => void;
}) {
  return (
    <>
      <Dome />
      <MilkyWay lat={props.lat} lon={props.lon} when={props.when} />
      <Horizon />
      <StarField
        placed={props.placed}
        showLines={props.showLines}
        showLabels={props.showLabels}
        selected={props.selected}
        onLabels={props.onLabels}
      />
      <LookController
        viewRef={props.viewRef}
        dragEnabled={props.dragEnabled}
        placed={props.placed}
        onPick={props.onPick}
      />
    </>
  );
}

export default function SkyView(props: React.ComponentProps<typeof Scene>) {
  return (
    <Canvas
      className="h-full w-full touch-none"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 0], fov: 62, near: 0.05, far: 240 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor("#070b14");
        gl.toneMapping = THREE.NoToneMapping;
      }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
