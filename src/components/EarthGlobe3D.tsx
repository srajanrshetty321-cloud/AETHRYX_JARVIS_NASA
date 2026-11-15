import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import type { GeoBoundingBox, GeoPoint, GeoRegion } from '../types/aethryx';

export interface EarthLayerOption {
  id: string;
  label: string;
  gibsLayer: string;
  source: string;
  units: string;
  defaultDate: string;
  description: string;
}

interface EarthGlobe3DProps {
  activeRegion: GeoRegion;
  layers: EarthLayerOption[];
  selectedLayerId: string;
  selectedDate: string;
  onSelectLayer?: (layerId: string) => void;
  onSelectDate?: (date: string) => void;
  onPickCoordinate?: (lat: number, lon: number) => void;
  drawingPolygon?: GeoPoint[];
  customBbox?: GeoBoundingBox | null;
  heightClass?: string;
  compact?: boolean;
}

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const u = (lon + 180) / 360;
  const v = (lat + 90) / 180;
  const phi = u * Math.PI * 2;
  const theta = (1 - v) * Math.PI;
  const x = -radius * Math.cos(phi) * Math.sin(theta);
  const y = radius * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

function createFallbackCanvasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#0b1d33');
    grad.addColorStop(0.5, '#091526');
    grad.addColorStop(1, '#0b1d33');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 1024; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function EarthGlobe3D({
  activeRegion,
  layers,
  selectedLayerId,
  selectedDate,
  onPickCoordinate,
  drawingPolygon,
  customBbox,
  heightClass = 'h-[420px]',
  compact = false,
}: EarthGlobe3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const earthMeshRef = useRef<THREE.Mesh | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const autoRotateRef = useRef(true);
  const isDraggingRef = useRef(false);
  const dragDistRef = useRef(0);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const targetRotRef = useRef<{ x: number; y: number } | null>(null);

  const [autoRotate, setAutoRotate] = useState(true);
  const [textureStatus, setTextureStatus] = useState<'loading' | 'live' | 'fallback'>('loading');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeLayerSpec = layers.find((l) => l.id === selectedLayerId) || layers[0];

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Initialize Three.js WebGL scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 3.35);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xdbeafe, 1.35);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(5, 3, 4);
    scene.add(sun);

    const globeGroup = new THREE.Group();
    globeGroupRef.current = globeGroup;
    scene.add(globeGroup);

    // Main Earth sphere
    const earthGeo = new THREE.SphereGeometry(1, 64, 64);
    const fallbackTex = createFallbackCanvasTexture();
    const earthMat = new THREE.MeshPhongMaterial({
      map: fallbackTex,
      specular: new THREE.Color(0x1e293b),
      shininess: 14,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMeshRef.current = earthMesh;
    globeGroup.add(earthMesh);

    // Subtle latitude/longitude graticule wireframe
    const graticuleGeo = new THREE.SphereGeometry(1.003, 24, 12);
    const graticuleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.08,
    });
    globeGroup.add(new THREE.Mesh(graticuleGeo, graticuleMat));

    // Atmospheric rim ring
    const atmoGeo = new THREE.SphereGeometry(1.03, 48, 48);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    globeGroup.add(new THREE.Mesh(atmoGeo, atmoMat));

    // Overlay group for pins, bboxes, polygons
    const overlayGroup = new THREE.Group();
    overlayGroupRef.current = overlayGroup;
    globeGroup.add(overlayGroup);

    // Subtle starfield
    const starVertices: number[] = [];
    for (let i = 0; i < 450; i++) {
      const r = 18 + (i % 7);
      const theta = ((i * 137.5) % 360) * (Math.PI / 180);
      const phi = Math.acos(1 - (2 * (i + 0.5)) / 450);
      starVertices.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x64748b, size: 0.04, transparent: true, opacity: 0.65 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Raycaster for click-to-select coordinate
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      dragDistRef.current = 0;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
      targetRotRef.current = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      dragDistRef.current += Math.abs(dx) + Math.abs(dy);
      prevMouseRef.current = { x: e.clientX, y: e.clientY };

      globeGroup.rotation.y += dx * 0.006;
      globeGroup.rotation.x = Math.max(-1.35, Math.min(1.35, globeGroup.rotation.x + dy * 0.006));
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasClick = isDraggingRef.current && dragDistRef.current < 5;
      isDraggingRef.current = false;
      if (wasClick && onPickCoordinate) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(earthMesh, false);
        if (hits.length > 0 && hits[0].uv) {
          const { x: u, y: v } = hits[0].uv;
          const lon = Number((u * 360 - 180).toFixed(4));
          const lat = Number((v * 180 - 90).toFixed(4));
          onPickCoordinate(lat, lon);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(1.65, Math.min(5.2, camera.position.z + e.deltaY * 0.0018));
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (targetRotRef.current) {
        globeGroup.rotation.y += (targetRotRef.current.y - globeGroup.rotation.y) * 0.08;
        globeGroup.rotation.x += (targetRotRef.current.x - globeGroup.rotation.x) * 0.08;
        if (
          Math.abs(targetRotRef.current.y - globeGroup.rotation.y) < 0.005 &&
          Math.abs(targetRotRef.current.x - globeGroup.rotation.x) < 0.005
        ) {
          targetRotRef.current = null;
        }
      } else if (autoRotateRef.current && !isDraggingRef.current) {
        globeGroup.rotation.y += 0.0012;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
    };
  }, []);

  // Load real NASA GIBS texture whenever layer or date changes
  useEffect(() => {
    const mesh = earthMeshRef.current;
    if (!mesh) return;
    let cancelled = false;
    setTextureStatus('loading');

    const loader = new THREE.TextureLoader();
    const url = `/api/earth/gibs-image?layer=${encodeURIComponent(selectedLayerId)}&date=${encodeURIComponent(
      selectedDate || activeLayerSpec?.defaultDate || '2004-08-01'
    )}`;

    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = mesh.material as THREE.MeshPhongMaterial;
        mat.map = tex;
        mat.needsUpdate = true;
        setTextureStatus('live');
      },
      undefined,
      () => {
        if (!cancelled) setTextureStatus('fallback');
      }
    );

    return () => {
      cancelled = true;
    };
  }, [selectedLayerId, selectedDate, activeLayerSpec?.defaultDate]);

  // Update active region marker, bounding box, and polygon overlays + rotate camera toward region
  useEffect(() => {
    const overlay = overlayGroupRef.current;
    if (!overlay) return;
    while (overlay.children.length > 0) {
      const child = overlay.children[0];
      overlay.remove(child);
    }

    // Active region pin
    const pinPos = latLonToVec3(activeRegion.lat, activeRegion.lon, 1.016);
    const pinGeo = new THREE.SphereGeometry(0.022, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
    const pinMesh = new THREE.Mesh(pinGeo, pinMat);
    pinMesh.position.copy(pinPos);
    overlay.add(pinMesh);

    const ringGeo = new THREE.RingGeometry(0.032, 0.044, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.copy(latLonToVec3(activeRegion.lat, activeRegion.lon, 1.012));
    ringMesh.lookAt(latLonToVec3(activeRegion.lat, activeRegion.lon, 2.0));
    overlay.add(ringMesh);

    // Bounding box wireframe
    const bbox = customBbox || activeRegion.bbox;
    if (bbox) {
      const corners = [
        latLonToVec3(bbox.south, bbox.west, 1.012),
        latLonToVec3(bbox.south, bbox.east, 1.012),
        latLonToVec3(bbox.north, bbox.east, 1.012),
        latLonToVec3(bbox.north, bbox.west, 1.012),
        latLonToVec3(bbox.south, bbox.west, 1.012),
      ];
      const boxGeo = new THREE.BufferGeometry().setFromPoints(corners);
      const boxMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
      overlay.add(new THREE.Line(boxGeo, boxMat));
    }

    // Custom drawn polygon vertices & loop
    const poly = drawingPolygon && drawingPolygon.length > 0 ? drawingPolygon : activeRegion.polygon;
    if (poly && poly.length >= 2) {
      const pts = poly.map((p) => latLonToVec3(p.lat, p.lon, 1.015));
      if (poly.length >= 3) pts.push(pts[0]);
      const polyGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const polyMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
      overlay.add(new THREE.Line(polyGeo, polyMat));
    }

    // Smoothly orient globe toward selected coordinates
    const targetLonRad = ((activeRegion.lon + 180) / 360) * Math.PI * 2;
    const rotY = Math.PI / 2 - targetLonRad;
    const rotX = (activeRegion.lat * Math.PI) / 180 * 0.7;
    targetRotRef.current = { x: rotX, y: rotY };
  }, [activeRegion, drawingPolygon, customBbox]);

  function handleResetView() {
    if (cameraRef.current) cameraRef.current.position.z = 3.35;
    const targetLonRad = ((activeRegion.lon + 180) / 360) * Math.PI * 2;
    targetRotRef.current = {
      x: (activeRegion.lat * Math.PI) / 180 * 0.7,
      y: Math.PI / 2 - targetLonRad,
    };
  }

  return (
    <div
      className={`relative bg-[#05080F] border border-slate-800 rounded overflow-hidden ${
        isFullscreen ? 'fixed inset-4 z-50 h-auto' : heightClass
      }`}
    >
      <div
        ref={containerRef}
        className="w-full h-full cursor-crosshair"
        aria-label="Interactive 3D NASA Earth Globe"
      />

      {/* Top-left coordinate & NASA GIBS attribution */}
      <div className="absolute top-3 left-3 pointer-events-none space-y-1">
        <div className="bg-[#07090E]/85 border border-slate-800 rounded px-2.5 py-1.5 text-[11px] font-mono tabular-nums text-slate-200">
          {activeRegion.name} · {activeRegion.lat.toFixed(3)}°, {activeRegion.lon.toFixed(3)}°
        </div>
        <div className="bg-[#07090E]/85 border border-slate-800 rounded px-2.5 py-1 text-[10px] text-slate-400">
          Layer: {activeLayerSpec?.label || 'Blue Marble'} ·{' '}
          {textureStatus === 'live'
            ? 'NASA GIBS Live Texture'
            : textureStatus === 'loading'
              ? 'Loading GIBS Imagery...'
              : 'Grid Fallback (GIBS date unavailable)'}
        </div>
      </div>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAutoRotate((v) => !v)}
          title={autoRotate ? 'Pause rotation' : 'Resume rotation'}
          className="p-2 bg-[#07090E]/85 border border-slate-700 rounded text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60 transition-colors"
        >
          {autoRotate ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onClick={handleResetView}
          title="Center on active region"
          className="p-2 bg-[#07090E]/85 border border-slate-700 rounded text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen globe'}
            className="p-2 bg-[#07090E]/85 border border-slate-700 rounded text-slate-300 hover:text-cyan-300 hover:border-cyan-500/60 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Bottom-left interaction hint & source legend */}
      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="bg-[#07090E]/85 border border-slate-800 rounded px-2.5 py-1 text-[10px] text-slate-400">
          Drag to orbit · Scroll to zoom · Click anywhere on Earth to select coordinates
        </div>
        {activeLayerSpec && (
          <div className="bg-[#07090E]/85 border border-slate-800 rounded px-2.5 py-1 text-[10px] font-mono text-slate-300">
            Source: {activeLayerSpec.source} · Units: {activeLayerSpec.units}
          </div>
        )}
      </div>
    </div>
  );
}
