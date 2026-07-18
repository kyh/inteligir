// The vault link graph — an alternate workspace surface rendering
// getLinkGraph on a hand-rolled canvas over a d3-force simulation. Chosen over
// react-force-graph-2d deliberately: d3-force is the only dependency (~15KB in
// this lazy chunk vs ~100KB+ for the wrapper stack), and owning the draw loop
// keeps node styling on the app's own CSS tokens (dark-mode aware for free).
//
// Interactions: wheel zooms about the cursor, drag pans, click opens the node
// (phantom nodes offer to create the note), Esc returns to the editor. Nodes
// are sized by degree; phantoms draw dashed; the active tab's note gets a
// highlight ring. Data refreshes on onKnowledgeUpdated, preserving layout
// positions by node id.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import { confirm } from "@repo/ui/components/confirm-dialog";

import { getBridge } from "@renderer/lib/bridge";
import { useTheme } from "@renderer/lib/use-theme";
import { useViewStore } from "@renderer/stores/view-store";
import { useVault } from "@renderer/workspace/vault-context";
import type { LinkGraph } from "@repo/core/knowledge/link-graph-index";

type SimNode = SimulationNodeDatum & {
  id: string;
  title: string;
  path?: string;
  phantom: boolean;
  degree: number;
};

/** Edges keep plain string endpoints for drawing/hit-work; d3's link force
 * gets its own throwaway array to mutate. */
type DrawEdge = { source: string; target: string; count: number };

type GraphData = {
  nodes: SimNode[];
  byId: Map<string, SimNode>;
  edges: DrawEdge[];
};

type Transform = { x: number; y: number; k: number };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
/** Zoom level above which every node gets a label (below it: hover/active only). */
const LABEL_ZOOM = 0.8;

function nodeRadius(node: SimNode): number {
  return 4 + Math.min(10, Math.sqrt(node.degree) * 2);
}

function toGraphData(graph: LinkGraph, previous: GraphData | null): GraphData {
  const byId = new Map<string, SimNode>();
  const nodes = graph.nodes.map((node): SimNode => {
    const prior = previous?.byId.get(node.id);
    const sim: SimNode = { ...node };
    // Carry the settled layout across refreshes so an index update nudges the
    // graph instead of re-rolling it.
    if (prior) {
      sim.x = prior.x;
      sim.y = prior.y;
      sim.vx = prior.vx;
      sim.vy = prior.vy;
    }
    byId.set(node.id, sim);
    return sim;
  });
  const edges = graph.edges.map((edge): DrawEdge => {
    return { source: edge.source, target: edge.target, count: edge.count };
  });
  return { nodes, byId, edges };
}

/** CSS token colors read off the canvas element, so the graph re-skins itself
 * with the theme. */
type Palette = {
  node: string;
  phantom: string;
  edge: string;
  label: string;
  halo: string;
  font: string;
};

function readPalette(canvas: HTMLCanvasElement): Palette {
  const style = getComputedStyle(canvas);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    node: token("--primary"),
    phantom: token("--muted-foreground"),
    edge: token("--border"),
    label: token("--muted-foreground"),
    halo: token("--ring"),
    font: `11px ${style.fontFamily}`,
  };
}

export default function GraphView() {
  const { openFile, createFile, openPath } = useVault();
  const setSurface = useViewStore((s) => s.setSurface);
  const { resolved: resolvedTheme } = useTheme();
  const [empty, setEmpty] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<GraphData | null>(null);
  const simRef = useRef<Simulation<SimNode, SimulationLinkDatum<SimNode>> | null>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const hoveredRef = useRef<SimNode | null>(null);
  const activePathRef = useRef<string | null>(openPath);
  const frameRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const palette = readPalette(canvas);
    const { x, y, k } = transformRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(width / 2 + x, height / 2 + y);
    ctx.scale(k, k);

    // Edges under nodes.
    ctx.strokeStyle = palette.edge;
    for (const edge of data.edges) {
      const source = data.byId.get(edge.source);
      const target = data.byId.get(edge.target);
      if (!source || !target) continue;
      if (
        source.x === undefined ||
        source.y === undefined ||
        target.x === undefined ||
        target.y === undefined
      )
        continue;
      ctx.lineWidth = Math.min(3, 0.75 + Math.log2(edge.count)) / k;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }

    const hovered = hoveredRef.current;
    const activePath = activePathRef.current;
    ctx.font = palette.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const node of data.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const r = nodeRadius(node);
      const isActive = node.path !== undefined && node.path === activePath;
      const isHovered = node === hovered;

      if (isActive || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3 / k, 0, Math.PI * 2);
        ctx.strokeStyle = palette.halo;
        ctx.lineWidth = 2 / k;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      if (node.phantom) {
        // Phantom (unresolved target): a dashed ghost outline, no fill.
        ctx.setLineDash([3 / k, 2 / k]);
        ctx.strokeStyle = palette.phantom;
        ctx.lineWidth = 1.25 / k;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = palette.node;
        ctx.fill();
      }

      if (k >= LABEL_ZOOM || isHovered || isActive) {
        ctx.fillStyle = palette.label;
        ctx.globalAlpha = node.phantom ? 0.7 : 1;
        ctx.fillText(node.title, node.x, node.y + r + 4 / k);
        ctx.globalAlpha = 1;
      }
    }
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  // Load + live-refresh the graph data, feeding one persistent simulation.
  useEffect(() => {
    const bridge = getBridge();
    let disposed = false;

    const apply = (graph: LinkGraph) => {
      if (disposed) return;
      const data = toGraphData(graph, dataRef.current);
      dataRef.current = data;
      setEmpty(data.nodes.length === 0);
      const links: SimulationLinkDatum<SimNode>[] = data.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
      }));
      const existing = simRef.current;
      if (existing) {
        existing.nodes(data.nodes);
        const linkForce =
          existing.force<ReturnType<typeof forceLink<SimNode, SimulationLinkDatum<SimNode>>>>(
            "link",
          );
        linkForce?.links(links);
        existing.alpha(0.3).restart();
        return;
      }
      const sim = forceSimulation<SimNode>(data.nodes)
        .force(
          "link",
          forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
            .id((node) => node.id)
            .distance(70)
            .strength(0.5),
        )
        .force("charge", forceManyBody().strength(-220))
        .force("center", forceCenter(0, 0))
        .force(
          "collide",
          forceCollide<SimNode>().radius((node) => nodeRadius(node) + 6),
        );
      sim.on("tick", scheduleDraw);
      simRef.current = sim;
    };

    const refresh = () => {
      bridge
        .getLinkGraph()
        .then(apply)
        .catch(() => {});
    };
    refresh();
    const unsubscribe = bridge.onKnowledgeUpdated(refresh);
    return () => {
      disposed = true;
      unsubscribe();
      simRef.current?.stop();
      simRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scheduleDraw]);

  // Size the canvas buffer to its CSS box (DPR-aware) and redraw on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      scheduleDraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scheduleDraw]);

  // Redraw on theme flips (colors are read at draw time) and active-note moves.
  useLayoutEffect(() => {
    activePathRef.current = openPath;
    scheduleDraw();
  }, [scheduleDraw, resolvedTheme, openPath]);

  // Esc returns to the editor surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSurface("editor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSurface]);

  /** Canvas-pixel position → the node under it, hit-testing in world space. */
  const nodeAt = useCallback((clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data) return null;
    const rect = canvas.getBoundingClientRect();
    const { x, y, k } = transformRef.current;
    const wx = (clientX - rect.left - rect.width / 2 - x) / k;
    const wy = (clientY - rect.top - rect.height / 2 - y) / k;
    let best: SimNode | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const node of data.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - wx;
      const dy = node.y - wy;
      const dist = Math.hypot(dx, dy);
      if (dist <= Math.max(nodeRadius(node) + 2, 8 / k) && dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    return best;
  }, []);

  // Pointer interactions: drag pans, click (sub-threshold movement) opens.
  const dragRef = useRef<{ id: number; startX: number; startY: number; moved: boolean } | null>(
    null,
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (drag.moved || Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          transformRef.current = {
            ...transformRef.current,
            x: transformRef.current.x + e.movementX,
            y: transformRef.current.y + e.movementY,
          };
          scheduleDraw();
        }
        return;
      }
      const hovered = nodeAt(e.clientX, e.clientY);
      if (hovered !== hoveredRef.current) {
        hoveredRef.current = hovered;
        e.currentTarget.style.cursor = hovered ? "pointer" : "grab";
        e.currentTarget.title = hovered
          ? hovered.phantom
            ? `${hovered.title} — not created yet`
            : (hovered.path ?? hovered.title)
          : "";
        scheduleDraw();
      }
    },
    [nodeAt, scheduleDraw],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.moved) return;
      const node = nodeAt(e.clientX, e.clientY);
      if (!node) return;
      if (node.phantom) {
        // Phantom → offer to create the missing note (created at the vault
        // root, matching wiki resolution for a bare target).
        const offerCreate = async () => {
          const confirmed = await confirm({
            title: `Create "${node.title}.md"?`,
            body: "This note doesn't exist yet — create it at the vault root.",
            confirmLabel: "Create",
          });
          if (confirmed) await createFile(node.title);
        };
        void offerCreate();
        return;
      }
      if (node.path !== undefined) openFile(node.path);
    },
    [createFile, nodeAt, openFile],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { x, y, k } = transformRef.current;
      const nextK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * Math.exp(-e.deltaY * 0.002)));
      if (nextK === k) return;
      // Zoom about the cursor: keep the world point under it fixed.
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      transformRef.current = {
        x: mx - ((mx - x) / k) * nextK,
        y: my - ((my - y) / k) * nextK,
        k: nextK,
      };
      scheduleDraw();
    },
    [scheduleDraw],
  );

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        aria-label="Vault link graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        className="h-full w-full cursor-grab touch-none"
      />
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Nothing to graph yet — link notes with [[wiki links]].
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/70">
        Scroll to zoom · drag to pan · click a note to open · Esc to close
      </div>
    </div>
  );
}
