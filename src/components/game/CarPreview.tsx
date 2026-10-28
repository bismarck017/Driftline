"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildCar, type CarSpec } from "@/game/cars";

/** Small rotating 3D preview of a car, used in the garage. */
export function CarPreview({ spec, className }: { spec: CarSpec; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const carRef = useRef<THREE.Group | null>(null);
  const rafRef = useRef(0);

  // one-time renderer setup
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    cam.position.set(5.6, 3.4, 6.2);
    cam.lookAt(0, 0.7, 0);
    camRef.current = cam;

    const hemi = new THREE.HemisphereLight(0xf2ead9, 0xcbbfae, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 2.0);
    key.position.set(5, 8, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe8f0f2, 0.7);
    rim.position.set(-6, 4, -4);
    scene.add(rim);

    // pedestal + soft contact shadow
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: 0xefe7da, roughness: 0.9 })
    );
    disc.position.y = -0.28;
    scene.add(disc);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.02;
    scene.add(shadow);

    const resize = () => {
      const w = host.clientWidth || 320;
      const h = host.clientHeight || 320;
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const clock = new THREE.Clock();
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      if (carRef.current) {
        carRef.current.rotation.y = clock.getElapsedTime() * 0.55;
      }
      renderer.render(scene, cam);
    };
    tick();

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      renderer.dispose();
      if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      carRef.current = null;
    };
  }, []);

  // rebuild car when the spec changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (carRef.current) {
      scene.remove(carRef.current);
      carRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) {
          mat.forEach((x) => x.dispose());
        } else if (mat) {
          mat.dispose();
        }
      });
    }
    const built = buildCar(spec);
    built.group.position.y = -0.05;
    scene.add(built.group);
    carRef.current = built.group;
  }, [spec]);

  return <div ref={hostRef} className={className} aria-label={`3D preview of the ${spec.name}`} />;
}
