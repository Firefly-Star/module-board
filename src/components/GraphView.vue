<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

import { manualLayout, NODE_H, type PlacedNode } from "../lib/logic";
import { STATUS_META, type GraphNode, type Status } from "../lib/types";

const props = defineProps<{
  nodes: GraphNode[];
  collapsed: ReadonlySet<string>;
  selected: string | null;
  selectedEdge: { from: string; to: string } | null;
  frontier: ReadonlySet<string>;
  focusFrontier: boolean;
  collapseCounts: Map<string, number>;
  statuses: Map<string, Status>;
}>();

const emit = defineEmits<{
  (e: "select", id: string | null): void;
  (e: "selectEdge", edge: { from: string; to: string } | null): void;
  (e: "toggleCollapse", id: string): void;
  (e: "moveNode", id: string, x: number, y: number): void;
  (e: "connect", dependent: string, dependency: string): void;
  (e: "deleteEdge", edge: { from: string; to: string }): void;
}>();

function metaOf(n: GraphNode) {
  return STATUS_META[props.statuses.get(n.id) ?? "open"];
}
function colorOf(n: GraphNode) {
  return metaOf(n).color;
}
function softOf(n: GraphNode) {
  return metaOf(n).soft;
}
function labelOf(n: GraphNode) {
  return metaOf(n).label;
}

// ---------- 布局：始终读 node.pos（手动）。缺 pos 的节点由调用方补默认。 ----------
const ids = computed(() => new Set(props.nodes.map((n) => n.id)));
const emptyDefaults = new Map<string, PlacedNode>();
const layoutResult = computed(() =>
  manualLayout(props.nodes, ids.value, emptyDefaults, props.collapsed),
);
const posMap = computed(() => layoutResult.value.pos);

// ---------- 视口 ----------
const view = reactive({ k: 1, tx: 0, ty: 0 });
let userMoved = false; // 用户做过平移/缩放/拖动后不再自动复位
const rootEl = ref<HTMLElement | null>(null);
const size = reactive({ w: 800, h: 500 });
let ro: ResizeObserver | null = null;

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function computeFit() {
  const b = layoutResult.value.bounds;
  const bw = Math.max(50, b.maxX - b.minX);
  const bh = Math.max(50, b.maxY - b.minY);
  const k = clamp(Math.min((size.w - 48) / bw, (size.h - 48) / bh), 0.15, 2.4);
  view.k = k;
  view.tx = size.w / 2 - ((b.minX + b.maxX) / 2) * k;
  view.ty = size.h / 2 - ((b.minY + b.maxY) / 2) * k;
}

function fitView() {
  userMoved = false;
  computeFit();
}
defineExpose({ fitView });

function toWorld(px: number, py: number): [number, number] {
  return [(px - view.tx) / view.k, (py - view.ty) / view.k];
}
function clientToWorld(e: PointerEvent): [number, number] {
  const r = rootEl.value!.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}

onMounted(() => {
  if (!rootEl.value) return;
  ro = new ResizeObserver(() => {
    const r = rootEl.value!.getBoundingClientRect();
    size.w = r.width;
    size.h = r.height;
    if (!userMoved) computeFit();
  });
  ro.observe(rootEl.value);
});
onUnmounted(() => ro?.disconnect());

watch(
  () => layoutResult.value.bounds,
  () => {
    if (!userMoved) computeFit();
  },
  { flush: "post" },
);

// ---------- 平移 / 缩放 ----------
let panning = false;
let lastX = 0;
let lastY = 0;

function bgDown(e: PointerEvent) {
  if (e.button !== 0) return;
  panning = true;
  userMoved = true;
  lastX = e.clientX;
  lastY = e.clientY;
}
function bgMove(e: PointerEvent) {
  if (!panning) return;
  view.tx += e.clientX - lastX;
  view.ty += e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
}
function bgUp() {
  panning = false;
}
function onWheel(e: WheelEvent) {
  userMoved = true;
  const r = rootEl.value!.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.14 : 0.88;
  const k2 = clamp(view.k * factor, 0.15, 3.2);
  const [wx, wy] = toWorld(px, py);
  view.k = k2;
  view.tx = px - wx * k2;
  view.ty = py - wy * k2;
}

// ---------- 节点几何 ----------
function posOf(n: GraphNode): PlacedNode {
  return posMap.value.get(n.id) ?? { id: n.id, x: 0, y: 0, w: 156, h: NODE_H };
}
function tfOf(n: GraphNode): string {
  const p = posOf(n);
  return `translate(${p.x - p.w / 2}px, ${p.y - p.h / 2}px)`;
}
function nodeStyle(n: GraphNode) {
  return {
    transform: tfOf(n),
    transition: drag.value?.id === n.id ? "none" : undefined,
  };
}
function edgePath(e: { fx: number; fy: number; tx: number; ty: number }): string {
  const dx = Math.max(20, (e.tx - e.fx) / 2);
  return `M ${e.fx} ${e.fy} C ${e.fx + dx} ${e.fy}, ${e.tx - dx} ${e.ty}, ${e.tx} ${e.ty}`;
}

// ---------- 节点拖动（随时可拖） ----------
const drag = ref<{ id: string; ox: number; oy: number } | null>(null);
let dragged = false;

function nodeDown(e: PointerEvent, n: GraphNode) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const p = posOf(n);
  const [wx, wy] = clientToWorld(e);
  drag.value = { id: n.id, ox: wx - p.x, oy: wy - p.y };
  dragged = false;
  userMoved = true;
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
}
function nodeMove(e: PointerEvent, n: GraphNode) {
  if (!drag.value || drag.value.id !== n.id) return;
  const [wx, wy] = clientToWorld(e);
  const nx = Math.round(wx - drag.value.ox);
  const ny = Math.round(wy - drag.value.oy);
  if (Math.abs(nx - posOf(n).x) > 0.5 || Math.abs(ny - posOf(n).y) > 0.5) dragged = true;
  emit("moveNode", n.id, nx, ny);
}
function nodeUp(e: PointerEvent) {
  const wasDragging = dragged;
  drag.value = null;
  if (!wasDragging) {
    const id = (e.currentTarget as Element).getAttribute("data-id");
    if (id) emit("select", id);
  }
}

// ---------- 连线（任意时刻可从出口拖到目标节点 = 目标依赖本节点，端点吸附入口） ----------
const wire = ref<{ source: string } | null>(null);
const wireCursor = ref<{ x: number; y: number } | null>(null);
const wireTarget = ref<string | null>(null);

function startWire(n: GraphNode, e: PointerEvent) {
  e.stopPropagation();
  if (e.button !== 0) return;
  wire.value = { source: n.id };
  wireTarget.value = null;
  const p = posOf(n);
  wireCursor.value = { x: p.x + p.w / 2, y: p.y };
}
const SNAP_PX = 26; // 距目标入口的吸附阈值（屏幕像素）

function onSvgMove(e: PointerEvent) {
  const r = rootEl.value!.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  if (wire.value) {
    const [wx, wy] = toWorld(px, py);
    wireCursor.value = { x: wx, y: wy };
    wireTarget.value = nearestInlet(px, py);
    snap.value = null;
    return;
  }
  snap.value = edgeAtScreen(px, py);
}

/** 返回离光标最近的可见节点入口 id（在 SNAP_PX 内才命中），否则 null。 */
function nearestInlet(px: number, py: number): string | null {
  let best: string | null = null;
  let bestD = SNAP_PX;
  for (const n of props.nodes) {
    if (n.id === wire.value?.source) continue;
    const p = posMap.value.get(n.id);
    if (!p) continue;
    const ix = (p.x - p.w / 2) * view.k + view.tx;
    const iy = p.y * view.k + view.ty;
    const d = Math.hypot(px - ix, py - iy);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

function onSvgUp() {
  if (!wire.value) return;
  if (wireTarget.value && wireTarget.value !== wire.value.source) {
    emit("connect", wireTarget.value, wire.value.source);
  }
  wire.value = null;
  wireTarget.value = null;
  wireCursor.value = null;
}
/** 拖线终点：吸附到目标节点入口（左缘中点），否则跟随光标。 */
const wireEnd = computed(() => {
  if (wireTarget.value) {
    const p = posMap.value.get(wireTarget.value);
    if (p) return { x: p.x - p.w / 2, y: p.y };
  }
  return wireCursor.value ?? { x: 0, y: 0 };
});
function wirePath(): string {
  if (!wire.value) return "";
  const n = props.nodes.find((x) => x.id === wire.value!.source);
  const p = n ? posMap.value.get(n.id) : null;
  if (!p) return "";
  const fx = p.x + p.w / 2;
  const fy = p.y;
  const { x: tx, y: ty } = wireEnd.value;
  const dx = Math.max(20, (tx - fx) / 2);
  return `M ${fx} ${fy} C ${fx + dx} ${fy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

// ---------- 悬停 / 选中 ----------
const hoverId = ref<string | null>(null);
const tip = ref<{ x: number; y: number; node: GraphNode } | null>(null);

function onNodeEnter(n: GraphNode) {
  hoverId.value = n.id;
  if (wire.value) return;
  const p = posMap.value.get(n.id);
  if (!p) return;
  tip.value = {
    x: p.x * view.k + view.tx - (p.w / 2) * view.k,
    y: p.y * view.k + view.ty,
    node: n,
  };
}
function onNodeLeave() {
  hoverId.value = null;
  tip.value = null;
}

function portShow(n: GraphNode): { show: boolean } {
  return {
    show:
      hoverId.value === n.id ||
      wire.value?.source === n.id ||
      wireTarget.value === n.id,
  };
}

function isEdgeHover(e: { from: string; to: string }): boolean {
  return hoverId.value === e.from || hoverId.value === e.to;
}
function isEdgeSelected(e: { from: string; to: string }): boolean {
  return props.selectedEdge?.from === e.from && props.selectedEdge?.to === e.to;
}

const tipStyle = computed(() => {
  if (!tip.value) return {};
  const boxW = 264;
  const gap = 10;
  let left = tip.value.x;
  let top = tip.value.y + NODE_H * view.k + gap;
  if (left + boxW > size.w - 8) left = Math.max(8, size.w - boxW - 8);
  if (top > size.h - 130) {
    top = tip.value.y - 150;
    if (top < 8) top = 8;
  }
  return { left: `${left}px`, top: `${top}px` };
});

const cursor = computed(() => {
  if (wire.value) return "crosshair";
  if (panning) return "grabbing";
  return "default";
});

// ---------- 边的磁吸（光标距线最近距离在阈值内则吸附） ----------
const SNAP_EDGE_PX = 12;
const snap = ref<{ from: string; to: string } | null>(null);

function bezSample(
  e: { fx: number; fy: number; tx: number; ty: number },
  n = 26,
): Array<[number, number]> {
  const dx = Math.max(20, (e.tx - e.fx) / 2);
  const p0x = e.fx, p0y = e.fy;
  const p1x = e.fx + dx, p1y = e.fy;
  const p2x = e.tx - dx, p2y = e.ty;
  const p3x = e.tx, p3y = e.ty;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    pts.push([a * p0x + b * p1x + c * p2x + d * p3x, a * p0y + b * p1y + c * p2y + d * p3y]);
  }
  return pts;
}

function segDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wl2 = vx * vx + vy * vy;
  const t = wl2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / wl2)) : 0;
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/** 光标（world 坐标）到边的最近距离。 */
function distToEdge(wx: number, wy: number, e: (typeof layoutResult.value.edges)[number]): number {
  const pts = bezSample(e);
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, segDist(wx, wy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return min;
}

function sameEdge(a: { from: string; to: string } | null, e: { from: string; to: string }) {
  return !!a && a.from === e.from && a.to === e.to;
}

/** 选择/点击坐标用：返回落在磁吸阈值内的最近边。 */
function edgeAtScreen(px: number, py: number): { from: string; to: string } | null {
  const [wx, wy] = toWorld(px, py);
  const threshold = SNAP_EDGE_PX / view.k;
  let best: { from: string; to: string } | null = null;
  let bestD = threshold;
  for (const e of layoutResult.value.edges) {
    const d = distToEdge(wx, wy, e);
    if (d < bestD) {
      bestD = d;
      best = { from: e.from, to: e.to };
    }
  }
  return best;
}

function onSvgLeave() {
  snap.value = null;
}

function bgClick() {
  if (snap.value) {
    emit("selectEdge", snap.value);
  } else {
    emit("selectEdge", null);
    emit("select", null);
  }
}

function bgDbl() {
  if (snap.value) return; // 双击在边上：交给选中
  fitView();
}
</script>

<template>
  <div ref="rootEl" class="gv">
    <svg
      class="gv-svg"
      :style="{ cursor }"
      @wheel.prevent="onWheel"
      @pointermove="onSvgMove"
      @pointerup="onSvgUp"
      @pointerleave="onSvgLeave"
    >
      <rect
        class="gv-bg"
        width="100%"
        height="100%"
        @pointerdown="bgDown"
        @pointermove="bgMove"
        @pointerup="bgUp"
        @pointerleave="bgUp"
        @click="bgClick"
        @dblclick.prevent="bgDbl"
      />
      <g :transform="`translate(${view.tx} ${view.ty}) scale(${view.k})`">
        <g
          v-for="e in layoutResult.edges"
          :key="`${e.from}->${e.to}`"
          class="edge-g"
          :class="{ snap: sameEdge(snap, e) }"
        >
          <path
            :d="edgePath(e)"
            class="edge"
            :class="{ hover: isEdgeHover(e), snap: sameEdge(snap, e), picked: isEdgeSelected(e) }"
            @pointerdown.stop
            @click="emit('selectEdge', { from: e.from, to: e.to })"
          />
          <g
            class="edge-del"
            :transform="`translate(${(e.fx + e.tx) / 2} ${(e.fy + e.ty) / 2})`"
            @pointerdown.stop
            @click.stop="emit('deleteEdge', { from: e.from, to: e.to })"
          >
            <title>删除这条依赖连线</title>
            <circle r="7" class="edge-del-bg" />
            <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" class="edge-del-x" />
          </g>
        </g>
        <path v-if="wire && wireCursor" :d="wirePath()" class="wire-temp" />

        <g
          v-for="n in nodes"
          :key="n.id"
          :data-id="n.id"
          class="node-g"
          :class="{ wt: wireTarget === n.id }"
          :style="nodeStyle(n)"
          @pointerdown="nodeDown($event, n)"
          @pointermove="nodeMove($event, n)"
          @pointerup="nodeUp"
          @pointercancel="nodeUp"
          @mouseenter="onNodeEnter(n)"
          @mouseleave="onNodeLeave"
        >
          <foreignObject :width="posOf(n).w" :height="posOf(n).h" style="overflow: visible">
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              class="nd"
              :style="{
                width: posOf(n).w + 'px',
                height: posOf(n).h + 'px',
                background: softOf(n),
                borderLeftColor: colorOf(n),
              }"
              :class="{
                sel: selected === n.id,
                frontier: focusFrontier && frontier.has(n.id),
              }"
            >
              <div class="nd-dot" :style="{ background: colorOf(n) }"></div>
              <div class="nd-body">
                <div class="nd-top">
                  <button
                    v-if="collapsed.has(n.id)"
                    class="nd-fold"
                    title="展开依赖子树"
                    @pointerdown.stop
                    @click.stop="emit('toggleCollapse', n.id)"
                  >
                    +{{ collapseCounts.get(n.id) ?? 0 }}
                  </button>
                  <button
                    v-else-if="n.deps.length"
                    class="nd-fold off"
                    title="折叠依赖子树"
                    @pointerdown.stop
                    @click.stop="emit('toggleCollapse', n.id)"
                  >
                    −
                  </button>
                  <span class="nd-grp">{{ n.group }}</span>
                </div>
                <div class="nd-label" :title="n.id">{{ n.label }}</div>
                <div class="nd-st">{{ labelOf(n) }}</div>
              </div>
            </div>
          </foreignObject>

          <circle
            class="port in"
            :class="portShow(n)"
            :cx="0"
            :cy="posOf(n).h / 2"
            r="7"
          >
            <title>入口：其它依赖从此接入</title>
          </circle>
          <circle
            class="port out"
            :class="portShow(n)"
            :cx="posOf(n).w"
            :cy="posOf(n).h / 2"
            r="7"
            @pointerdown.stop="startWire(n, $event)"
          >
            <title>出口：拖到目标节点，表示「目标依赖本节点」</title>
          </circle>
        </g>
      </g>
    </svg>

    <div v-if="tip" class="gv-tip" :style="tipStyle">
      <div class="tip-title">
        <span class="tip-dot" :style="{ background: colorOf(tip.node) }"></span>
        {{ tip.node.label }}
      </div>
      <div v-if="tip.node.desc" class="tip-line">{{ tip.node.desc }}</div>
      <div class="tip-line dim">依赖 {{ tip.node.deps.length }} · {{ labelOf(tip.node) }}</div>
      <div v-if="tip.node.later?.length" class="tip-line amber">
        第二轮备注 ×{{ tip.node.later.length }}
      </div>
    </div>
  </div>
</template>
