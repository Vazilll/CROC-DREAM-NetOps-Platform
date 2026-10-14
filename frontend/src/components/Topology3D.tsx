import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Sparkles,
  Server,
  Zap,
  Maximize2,
  Minimize2,
  ExternalLink,
} from 'lucide-react';
import type { Device } from '../api';

interface Topology3DProps {
  devices: Device[];
  onSelectDevice: (deviceId: number) => void;
  onRunDryRun?: (deviceIds: number[]) => void;
  onInspectIntent?: (deviceId: number) => void;
  isJobRunning?: boolean;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Node3DData {
  id: number;
  hostname: string;
  role: Device['role'];
  platform: string;
  ip: string;
  status: string;
  position: Vec3;
  screenX?: number;
  screenY?: number;
  screenR?: number;
}

const CUBE_VERTICES: Vec3[] = [
  { x: -0.6, y: -0.6, z: -0.6 },
  { x: 0.6, y: -0.6, z: -0.6 },
  { x: 0.6, y: 0.6, z: -0.6 },
  { x: -0.6, y: 0.6, z: -0.6 },
  { x: -0.6, y: -0.6, z: 0.6 },
  { x: 0.6, y: -0.6, z: 0.6 },
  { x: 0.6, y: 0.6, z: 0.6 },
  { x: -0.6, y: 0.6, z: 0.6 },
];

const CUBE_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const OCTA_VERTICES: Vec3[] = [
  { x: 0, y: 0.85, z: 0 },
  { x: 0, y: -0.85, z: 0 },
  { x: 0.85, y: 0, z: 0 },
  { x: -0.85, y: 0, z: 0 },
  { x: 0, y: 0, z: 0.85 },
  { x: 0, y: 0, z: -0.85 },
];

const OCTA_EDGES: [number, number][] = [
  [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 4], [4, 3], [3, 5], [5, 2],
];

function rotatePoint(p: Vec3, rx: number, ry: number): Vec3 {
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const x1 = p.x * cosY - p.z * sinY;
  const z1 = p.z * cosY + p.x * sinY;

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const y2 = p.y * cosX - z1 * sinX;
  const z2 = z1 * cosX + p.y * sinX;

  return { x: x1, y: y2, z: z2 };
}

function projectPoint(
  p: Vec3,
  width: number,
  height: number,
  camZ: number
): { x: number; y: number; scale: number; visible: boolean } {
  const fov = Math.min(width, height) * 0.95;
  const dist = camZ - p.z;
  if (dist <= 0.5) {
    return { x: width / 2, y: height / 2, scale: 0, visible: false };
  }
  const scale = fov / dist;
  return {
    x: width / 2 + p.x * scale,
    y: height / 2 - p.y * scale,
    scale,
    visible: true,
  };
}

export const Topology3D: React.FC<Topology3DProps> = ({
  devices,
  onSelectDevice,
  onRunDryRun,
  onInspectIntent,
  isJobRunning = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredNode, setHoveredNode] = useState<Node3DData | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node3DData | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [burstMode, setBurstMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const autoRotateRef = useRef(autoRotate);
  const burstModeRef = useRef(burstMode);
  const isJobRunningRef = useRef(isJobRunning);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { burstModeRef.current = burstMode; }, [burstMode]);
  useEffect(() => { isJobRunningRef.current = isJobRunning; }, [isJobRunning]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Build 3D CLOS Coordinates
    const positions: Record<string, Vec3> = {};
    const assignTier = (tierDevs: Device[], y: number, spread = 6.4, zOffset = 0) => {
      const n = tierDevs.length;
      tierDevs.forEach((d, idx) => {
        const x = n === 1 ? 0 : -spread / 2 + (idx * spread) / (n - 1);
        const z = n > 2 ? Math.sin((idx / Math.max(1, n - 1)) * Math.PI) * 1.4 + zOffset : zOffset;
        positions[d.hostname] = { x, y, z };
      });
    };

    const borders = devices.filter((d) => ['border', 'border_firewall'].includes(d.role));
    const spines = devices.filter((d) => d.role === 'spine');
    const leaves = devices.filter((d) => d.role === 'leaf');
    const servers = devices.filter((d) => d.role === 'server' || d.platform === 'linux_server');

    assignTier(borders, 3.4, 5.0, -0.8);
    assignTier(spines, 1.8, 5.6, 0.4);
    assignTier(leaves, -1.8, Math.max(5.6, (leaves.length - 1) * 3.0), -0.4);
    assignTier(servers, -3.4, 5.0, 0.8);

    const nodes: Node3DData[] = devices.map((dev) => ({
      id: dev.id,
      hostname: dev.hostname,
      role: dev.role,
      platform: dev.platform,
      ip: dev.management_ip,
      status: dev.status,
      position: positions[dev.hostname] || { x: 0, y: 0, z: 0 },
    }));

    // 2. Build CLOS Links & Traveling Photons
    const links: { start: Vec3; end: Vec3 }[] = [];
    borders.forEach((b) => {
      spines.forEach((s) => {
        if (positions[b.hostname] && positions[s.hostname]) {
          links.push({ start: positions[b.hostname], end: positions[s.hostname] });
        }
      });
    });
    leaves.forEach((l) => {
      spines.forEach((s) => {
        if (positions[l.hostname] && positions[s.hostname]) {
          links.push({ start: positions[l.hostname], end: positions[s.hostname] });
        }
      });
    });
    servers.forEach((srv) => {
      leaves.slice(0, 2).forEach((l) => {
        if (positions[srv.hostname] && positions[l.hostname]) {
          links.push({ start: positions[srv.hostname], end: positions[l.hostname] });
        }
      });
    });

    const packets: { start: Vec3; end: Vec3; progress: number; speed: number }[] = [];
    links.forEach((link, idx) => {
      for (let p = 0; p < 2; p++) {
        packets.push({
          start: p === 0 ? link.start : link.end,
          end: p === 0 ? link.end : link.start,
          progress: (idx * 0.25 + p * 0.5) % 1,
          speed: 0.005 + (idx % 3) * 0.0015,
        });
      }
    });

    // 3. Starfield background
    const stars: Vec3[] = Array.from({ length: 140 }, (_, i) => ({
      x: Math.sin(i * 12.9898) * 14,
      y: Math.cos(i * 78.233) * 10,
      z: Math.sin(i * 45.164) * 8 - 2,
    }));

    // 4. Camera & Interaction State
    let rotX = 0.22;
    let rotY = -0.35;
    let camZ = (container.clientWidth || 600) < 640 ? 12.5 : 10.2;
    let isDragging = false;
    let dragDist = 0;
    let prevMouse = { x: 0, y: 0 };

    const updateSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 420;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    updateSize();

    const findHitNode = (clientX: number, clientY: number): Node3DData | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.screenX !== undefined && n.screenY !== undefined && n.screenR !== undefined) {
          const dx = mx - n.screenX;
          const dy = my - n.screenY;
          if (dx * dx + dy * dy <= Math.max(24, n.screenR * 1.35) ** 2) {
            return n;
          }
        }
      }
      return null;
    };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      dragDist = 0;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - prevMouse.x;
        const dy = e.clientY - prevMouse.y;
        dragDist += Math.abs(dx) + Math.abs(dy);
        rotY += dx * 0.007;
        rotX = Math.max(-1.1, Math.min(1.1, rotX + dy * 0.007));
        prevMouse = { x: e.clientX, y: e.clientY };
      }
      const hit = findHitNode(e.clientX, e.clientY);
      setHoveredNode(hit);
      canvas.style.cursor = hit ? 'pointer' : isDragging ? 'grabbing' : 'grab';
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onClick = (e: MouseEvent) => {
      if (dragDist > 6) return;
      const hit = findHitNode(e.clientX, e.clientY);
      if (hit) {
        setSelectedNode(hit);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZ = Math.max(6.5, Math.min(16, camZ + e.deltaY * 0.008));
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    // 5. Render Loop
    let frameId = 0;
    let t = 0;

    const render = () => {
      frameId = requestAnimationFrame(render);
      t += 0.016;

      const width = container.clientWidth || 320;
      const height = container.clientHeight || 420;

      if (autoRotateRef.current && !isDragging) {
        rotY += 0.0035;
      }

      ctx.clearRect(0, 0, width, height);

      // Floor Cyber Grid at y = -3.8
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
      ctx.lineWidth = 1;
      for (let g = -8; g <= 8; g += 2) {
        const p1 = projectPoint(rotatePoint({ x: g, y: -3.8, z: -8 }, rotX, rotY), width, height, camZ);
        const p2 = projectPoint(rotatePoint({ x: g, y: -3.8, z: 8 }, rotX, rotY), width, height, camZ);
        if (p1.visible && p2.visible) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        const q1 = projectPoint(rotatePoint({ x: -8, y: -3.8, z: g }, rotX, rotY), width, height, camZ);
        const q2 = projectPoint(rotatePoint({ x: 8, y: -3.8, z: g }, rotX, rotY), width, height, camZ);
        if (q1.visible && q2.visible) {
          ctx.beginPath();
          ctx.moveTo(q1.x, q1.y);
          ctx.lineTo(q2.x, q2.y);
          ctx.stroke();
        }
      }

      // Starfield
      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      for (const s of stars) {
        const sp = projectPoint(rotatePoint(s, rotX * 0.4, rotY * 0.4), width, height, camZ);
        if (sp.visible) {
          ctx.fillRect(sp.x, sp.y, 1.5, 1.5);
        }
      }

      // CLOS Optical Links
      for (const link of links) {
        const a = projectPoint(rotatePoint(link.start, rotX, rotY), width, height, camZ);
        const b = projectPoint(rotatePoint(link.end, rotX, rotY), width, height, camZ);
        if (a.visible && b.visible) {
          ctx.strokeStyle = burstModeRef.current || isJobRunningRef.current
            ? 'rgba(245, 158, 11, 0.42)'
            : 'rgba(56, 189, 248, 0.32)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Traveling Data Packets
      const speedMult = burstModeRef.current || isJobRunningRef.current ? 3.8 : 1.0;
      for (const pkt of packets) {
        pkt.progress = (pkt.progress + pkt.speed * speedMult) % 1;
        const cur: Vec3 = {
          x: pkt.start.x + (pkt.end.x - pkt.start.x) * pkt.progress,
          y: pkt.start.y + (pkt.end.y - pkt.start.y) * pkt.progress,
          z: pkt.start.z + (pkt.end.z - pkt.start.z) * pkt.progress,
        };
        const pp = projectPoint(rotatePoint(cur, rotX, rotY), width, height, camZ);
        if (pp.visible) {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, Math.max(2.2, pp.scale * 0.06), 0, Math.PI * 2);
          ctx.fillStyle = burstModeRef.current || isJobRunningRef.current ? '#f59e0b' : '#38bdf8';
          ctx.fill();
        }
      }

      // Nodes (Painter's algorithm by rotated Z)
      const sortedNodes = [...nodes].map((n) => ({
        node: n,
        rotPos: rotatePoint(n.position, rotX, rotY),
      })).sort((a, b) => a.rotPos.z - b.rotPos.z);

      for (const { node, rotPos } of sortedNodes) {
        const center = projectPoint(rotPos, width, height, camZ);
        if (!center.visible) continue;

        const isSpine = node.role === 'spine';
        const baseVerts = isSpine ? OCTA_VERTICES : CUBE_VERTICES;
        const baseEdges = isSpine ? OCTA_EDGES : CUBE_EDGES;

        const strokeMain = isSpine
          ? '#a855f7'
          : node.platform === 'huawei_vrp'
          ? '#f43f5e'
          : '#06b6d4';

        const auraStroke =
          node.status === 'DRIFT_DETECTED'
            ? 'rgba(245, 158, 11, 0.55)'
            : node.status === 'UNREACHABLE'
            ? 'rgba(239, 68, 68, 0.6)'
            : 'rgba(16, 185, 129, 0.45)';

        const radius = Math.max(14, center.scale * 0.65);
        node.screenX = center.x;
        node.screenY = center.y;
        node.screenR = radius;

        // Pulsing status aura ring
        const pulse = 1 + Math.sin(t * 3 + node.id) * 0.08;
        ctx.beginPath();
        ctx.ellipse(
          center.x,
          center.y,
          radius * 1.25 * pulse,
          radius * 0.72 * pulse,
          Math.sin(t * 0.7) * 0.25,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = auraStroke;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // 3D Polyhedron Wireframe
        const projVerts = baseVerts.map((v) => {
          const localRot = rotatePoint(v, t * 0.6 + node.id, t * 0.9 + node.id);
          return projectPoint(
            {
              x: rotPos.x + localRot.x * 0.7,
              y: rotPos.y + localRot.y * 0.7,
              z: rotPos.z + localRot.z * 0.7,
            },
            width,
            height,
            camZ
          );
        });

        ctx.strokeStyle = strokeMain;
        ctx.lineWidth = 1.6;
        for (const [i, j] of baseEdges) {
          const va = projVerts[i];
          const vb = projVerts[j];
          if (va.visible && vb.visible) {
            ctx.beginPath();
            ctx.moveTo(va.x, va.y);
            ctx.lineTo(vb.x, vb.y);
            ctx.stroke();
          }
        }

        // Node Label Pill
        const shortName = node.hostname.split('.')[0];
        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        const textW = ctx.measureText(shortName).width;
        const pillW = textW + 14;
        const pillH = 18;
        const pillX = center.x - pillW / 2;
        const pillY = center.y + radius + 6;

        ctx.fillStyle = 'rgba(9, 13, 22, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shortName, center.x, pillY + pillH / 2);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(frameId);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('wheel', onWheel);
      resizeObserver.disconnect();
    };
  }, [devices]);

  const spineCount = devices.filter((d) => d.role === 'spine').length;
  const leafCount = devices.filter((d) => d.role === 'leaf').length;

  return (
    <div
      className={`relative bg-[#050811] border border-white/[0.06] rounded-xl overflow-hidden transition-all duration-300 ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'h-[380px] sm:h-[460px]'
      }`}
    >
      {/* 3D Interactive Canvas */}
      <div ref={containerRef} className="w-full h-full">
        <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />
      </div>

      {/* Floating Header Overlay */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex items-center space-x-2.5 max-w-[60%] sm:max-w-none">
        <div className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-xl bg-indigo-500/20 border border-indigo-500/30 backdrop-blur flex items-center justify-center text-indigo-400 shadow-lg">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xs sm:text-sm font-extrabold text-white tracking-wide flex items-center space-x-2 truncate">
            <span className="truncate">3D CLOS Topology</span>
            <span className="hidden sm:inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Interactive 3D
            </span>
          </h3>
          <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
            {spineCount}x Spine • {leafCount}x Leaf • eBGP Multi-Vendor Fabric
          </p>
        </div>
      </div>

      {/* Control Buttons (Top Right) */}
      <div className="absolute top-3 right-3 z-10 flex items-center space-x-1.5 sm:space-x-2">
        <button
          onClick={() => setBurstMode(!burstMode)}
          className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold backdrop-blur border transition flex items-center space-x-1.5 shadow-sm cursor-pointer ${
            burstMode
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/20'
              : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800'
          }`}
          title="Сымитировать всплеск трафика телеметрии"
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{burstMode ? 'Traffic Burst ON' : 'Burst Test'}</span>
        </button>

        <button
          onClick={() => setAutoRotate(!autoRotate)}
          className={`p-2 rounded-xl backdrop-blur border text-xs transition cursor-pointer ${
            autoRotate
              ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:text-white'
          }`}
          title="Автоповорот 3D камеры"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="p-2 rounded-xl bg-slate-900/80 text-slate-400 hover:text-white border border-slate-700 backdrop-blur transition cursor-pointer"
          title={isFullscreen ? 'Свернуть' : 'Развернуть во весь экран'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Hovered Node Quick Tooltip */}
      {hoveredNode && !selectedNode && (
        <div className="absolute top-16 left-3 z-10 bg-slate-900/90 border border-slate-700 backdrop-blur-md p-3 rounded-2xl shadow-xl pointer-events-none text-xs space-y-1.5 max-w-[calc(100vw-2rem)] sm:min-w-[220px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-white font-mono truncate">{hoveredNode.hostname}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              {hoveredNode.ip}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            ОС: <span className="text-slate-200 font-mono uppercase">{hoveredNode.platform}</span> • Роль:{' '}
            <span className="text-slate-200 capitalize">{hoveredNode.role}</span>
          </div>
          <div className="flex items-center space-x-1.5 pt-1 border-t border-slate-800 text-[11px]">
            <span className="text-slate-400">Статус:</span>
            <span
              className={`font-semibold ${
                hoveredNode.status === 'IN_SYNC'
                  ? 'text-emerald-400'
                  : hoveredNode.status === 'DRIFT_DETECTED'
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {hoveredNode.status}
            </span>
          </div>
        </div>
      )}

      {/* Selected Node Action Card (Bottom Left) */}
      {selectedNode && (
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto z-20 bg-slate-900/95 border border-indigo-500/40 backdrop-blur-md p-3.5 rounded-2xl shadow-2xl text-xs space-y-2.5 sm:min-w-[300px] max-w-[calc(100vw-1.5rem)]">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center space-x-2 min-w-0">
              <Server className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-bold text-white font-mono truncate">{selectedNode.hostname}</span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-slate-500 hover:text-slate-300 text-xs px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="space-y-1 text-slate-300 text-[11px]">
            <div>IP: <span className="font-mono text-slate-200">{selectedNode.ip}</span></div>
            <div>Платформа: <span className="font-mono text-slate-200 uppercase">{selectedNode.platform}</span></div>
            <div>Статус: <span className="font-semibold text-emerald-400">{selectedNode.status}</span></div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {onRunDryRun && (
              <button
                onClick={() => onRunDryRun([selectedNode.id])}
                className="flex-1 py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                Dry-Run
              </button>
            )}
            {onInspectIntent && (
              <button
                onClick={() => onInspectIntent(selectedNode.id)}
                className="py-1.5 px-2.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 rounded-lg text-xs font-medium border border-cyan-500/30 transition cursor-pointer"
              >
                Intent
              </button>
            )}
            <button
              onClick={() => onSelectDevice(selectedNode.id)}
              className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition flex items-center space-x-1 cursor-pointer"
            >
              <span>Паспорт</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </button>
          </div>
        </div>
      )}

      {/* Legend & Help Indicator (Bottom Right) */}
      <div className="hidden md:flex absolute bottom-3 right-3 z-10 items-center space-x-3 bg-slate-900/80 border border-slate-800/80 backdrop-blur px-3 py-1.5 rounded-xl text-[11px] text-slate-400 pointer-events-none">
        <div className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
          <span>Spine (Arista / Cisco)</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
          <span>Leaf (Cisco / Huawei)</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span>In Sync</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <span>Drift</span>
        </div>
      </div>
    </div>
  );
};
