import * as dagre from "@dagrejs/dagre";

import type { GraphNode, NodePos, Status } from "./types";

export interface PlacedNode {
  id: string;
  x: number; // 中心坐标
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  fx: number; // 起点（依赖侧，靠左）
  fy: number;
  tx: number; // 终点（依赖者，靠右）
  ty: number;
}

export interface LayoutResult {
  pos: Map<string, PlacedNode>;
  edges: PlacedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export const NODE_W_MIN = 156;
export const NODE_H = 58;

export function estimateWidth(label: string): number {
  const w = 118 + Math.max(6, label.length) * 6.6;
  return Math.min(340, Math.max(NODE_W_MIN, w));
}

export function indexById(nodes: GraphNode[]): Map<string, GraphNode> {
  const m = new Map<string, GraphNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

/** 可见节点集合。
 *
 * 折叠语义：被折叠节点 C 只“断掉”它指向其依赖的边，C 本身仍可见；
 * 只有“断边后没有任何可见节点还依赖它 / 它到可见图失去全部连接”的节点才被隐藏，
 * 隐藏会沿依赖方向向下级联。
 *
 * 算法（沿“依赖者→依赖”方向传播）：
 *  - 根 = 没有被任何节点依赖的节点，必然可见；
 *  - 可见节点若未折叠，则它依赖的所有节点都可见；
 *  - 折叠节点不向其依赖传播 → 失去其他路径的依赖子树自然不可见。
 */
export function computeVisible(
  nodes: GraphNode[],
  collapsed: ReadonlySet<string>,
): Set<string> {
  const byId = indexById(nodes);
  const dependents = new Map<string, string[]>();
  for (const n of nodes) dependents.set(n.id, []);
  for (const n of nodes) {
    for (const d of n.deps) {
      dependents.get(d)?.push(n.id);
    }
  }

  const visible = new Set<string>();
  const stack = nodes
    .filter((n) => (dependents.get(n.id)?.length ?? 0) === 0)
    .map((n) => n.id);

  while (stack.length) {
    const id = stack.pop()!;
    if (visible.has(id)) continue;
    visible.add(id);
    const n = byId.get(id);
    if (!n || collapsed.has(id)) continue; // 折叠节点不断向其依赖传播
    for (const d of n.deps) {
      if (!visible.has(d)) stack.push(d);
    }
  }
  return visible;
}

/** 折叠节点 C 展开后会新出现的节点数（用于 chip 上的 +N）。 */
export function revealDelta(
  nodes: GraphNode[],
  collapsed: ReadonlySet<string>,
  id: string,
): number {
  if (!collapsed.has(id)) return 0;
  const withC = computeVisible(nodes, collapsed);
  const without = new Set(collapsed);
  without.delete(id);
  const withoutC = computeVisible(nodes, without);
  return withoutC.size - withC.size;
}

/** 以 root 为终点的依赖子树：root + 沿 deps 递归可达的全部依赖。 */
export function computeDependencyClosure(nodes: GraphNode[], root: string): Set<string> {
  const byId = indexById(nodes);
  const set = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const id = stack.pop()!;
    if (set.has(id)) continue;
    set.add(id);
    const node = byId.get(id);
    if (!node) continue;
    for (const d of node.deps) stack.push(d);
  }
  return set;
}

/** 推导每个节点的展示状态。
 *
 * 规则（“自动提示 + 手动确认”）：
 *  - 手动已实现 → implemented（绿）
 *  - 否则：frozen==yes 且全部依赖已实现 → ready（“依赖已齐·待实现”，紫，等手动勾选）
 *  - 否则：frozen==yes → frozen（蓝，等依赖）
 *  - 否则 → open（琥珀）
 */
export function computeStatuses(nodes: GraphNode[]): Map<string, Status> {
  const byId = indexById(nodes);
  const implementedIds = new Set(nodes.filter((n) => n.implemented).map((n) => n.id));
  const statuses = new Map<string, Status>();
  for (const n of nodes) {
    if (n.implemented) {
      statuses.set(n.id, "implemented");
      continue;
    }
    if (n.frozen === "yes") {
      const depsDone =
        n.deps.length === 0 ||
        n.deps.every((d) => byId.has(d) && implementedIds.has(d));
      statuses.set(n.id, depsDone ? "ready" : "frozen");
    } else {
      statuses.set(n.id, "open");
    }
  }
  return statuses;
}

/** 实现前沿 = “依赖已齐·待实现”的节点（自动提示，等手动确认已实现）。 */
export function computeFrontier(nodes: GraphNode[]): Set<string> {
  const s = computeStatuses(nodes);
  const out = new Set<string>();
  for (const [id, st] of s) if (st === "ready") out.add(id);
  return out;
}

function buildEdges(
  nodes: GraphNode[],
  pos: Map<string, PlacedNode>,
  collapsed: ReadonlySet<string>,
): PlacedEdge[] {
  const byId = indexById(nodes);
  const edges: PlacedEdge[] = [];
  for (const [id, p] of pos) {
    if (collapsed.has(id)) continue; // 指向被折叠节点的边不再画（折叠节点断掉入边）
    const n = byId.get(id);
    if (!n) continue;
    for (const dep of n.deps) {
      const q = pos.get(dep);
      if (!q) continue;
      edges.push({
        from: dep,
        to: id,
        fx: q.x + q.w / 2,
        fy: q.y,
        tx: p.x - p.w / 2,
        ty: p.y,
      });
    }
  }
  return edges;
}

function finalize(
  nodes: GraphNode[],
  visible: Set<string>,
  pos: Map<string, PlacedNode>,
  collapsed: ReadonlySet<string>,
): LayoutResult {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const id of visible) {
    const p = pos.get(id);
    if (!p) continue;
    minX = Math.min(minX, p.x - p.w / 2);
    minY = Math.min(minY, p.y - p.h / 2);
    maxX = Math.max(maxX, p.x + p.w / 2);
    maxY = Math.max(maxY, p.y + p.h / 2);
  }
  if (!visible.size) minX = minY = maxX = maxY = 0;
  return {
    pos,
    edges: buildEdges(nodes, pos, collapsed),
    bounds: { minX, minY, maxX, maxY },
  };
}

/** 自动布局：dagre 按拓扑分层。 */
export function autoLayout(
  nodes: GraphNode[],
  visible: Set<string>,
  collapsed: ReadonlySet<string> = new Set(),
): LayoutResult {
  const byId = indexById(nodes);
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 28,
    ranksep: 84,
    marginx: 60,
    marginy: 60,
    ranker: "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of visible) {
    const n = byId.get(id);
    if (!n) continue;
    g.setNode(id, { width: estimateWidth(n.label), height: NODE_H });
  }
  for (const id of visible) {
    if (collapsed.has(id)) continue;
    const n = byId.get(id);
    if (!n) continue;
    for (const dep of n.deps) {
      if (visible.has(dep)) g.setEdge(dep, id);
    }
  }
  dagre.layout(g);

  const pos = new Map<string, PlacedNode>();
  for (const id of visible) {
    const d = g.node(id);
    if (!d) continue;
    pos.set(id, { id, x: d.x, y: d.y, w: d.width, h: d.height });
  }
  return finalize(nodes, visible, pos, collapsed);
}

/** 手动布局：直接使用 nodes[i].pos（中心）。缺 pos 的节点退化为就近默认位置。 */
export function manualLayout(
  nodes: GraphNode[],
  visible: Set<string>,
  defaults: Map<string, PlacedNode>,
  collapsed: ReadonlySet<string> = new Set(),
): LayoutResult {
  const byId = indexById(nodes);
  const pos = new Map<string, PlacedNode>();
  const placed = new Set<string>();
  let cursor = 24;
  for (const id of visible) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.pos) {
      pos.set(id, {
        id,
        x: n.pos.x,
        y: n.pos.y,
        w: estimateWidth(n.label),
        h: NODE_H,
      });
      placed.add(id);
    }
  }
  // 给没有 pos 的可见节点一个默认落点
  for (const id of visible) {
    if (placed.has(id)) continue;
    const d = defaults.get(id);
    const n = byId.get(id);
    if (!n) continue;
    const [dx, dy] = [d ? d.x : cursor, d ? d.y : 60];
    pos.set(id, { id, x: dx, y: dy, w: estimateWidth(n.label), h: NODE_H });
    if (!d) cursor += 40;
  }
  return finalize(nodes, visible, pos, collapsed);
}

export type { NodePos };
