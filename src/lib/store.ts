import { reactive, watch } from "vue";

import { indexById } from "./logic";
import { SAMPLE_DATA } from "./sample";
import type { Freeze, GraphData, GraphNode, NodePatch, Status } from "./types";

export type StatusFilter = "all" | Status;

interface StoreState {
  data: GraphData;
  collapsed: Set<string>;
  selected: string | null;
  selectedEdge: { from: string; to: string } | null;
  filter: StatusFilter;
  focusFrontier: boolean;
  focus: string | null;
}

const LS_DATA = "module-board:data";
const LS_VIEW = "module-board:view";

function loadData(): GraphData {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) {
      const parsed = JSON.parse(raw) as GraphData;
      if (Array.isArray(parsed.nodes)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return structuredClone(SAMPLE_DATA);
}

const state = reactive<StoreState>({
  data: loadData(),
  collapsed: new Set(),
  selected: null,
  selectedEdge: null,
  filter: "all",
  focusFrontier: false,
  focus: null,
});

watch(
  () => state.data,
  (d) => localStorage.setItem(LS_DATA, JSON.stringify(d)),
  { deep: true },
);
watch(
  () => ({ collapsed: [...state.collapsed], filter: state.filter }),
  (v) => localStorage.setItem(LS_VIEW, JSON.stringify(v)),
);

// ---------- 撤销 / 重做（单步，300ms 合并连击成一步） ----------
let lastUndo: string | null = null;
let lastRedo: string | null = null;
let pendingPrev: string | null = null;
let burstTimer: number | undefined;
let restoring = false;

function clearBurst() {
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = undefined;
  pendingPrev = null;
}

watch(
  () => exportJson(),
  (_cur, prev) => {
    if (restoring) return;
    if (pendingPrev === null) pendingPrev = prev;
    if (burstTimer) clearTimeout(burstTimer);
    burstTimer = window.setTimeout(() => {
      if (pendingPrev !== null && pendingPrev !== exportJson()) {
        lastUndo = pendingPrev;
        lastRedo = null;
      }
      pendingPrev = null;
      burstTimer = undefined;
    }, 300);
  },
);

function restoreTo(text: string) {
  const parsed = JSON.parse(text) as GraphData;
  if (!Array.isArray(parsed.nodes)) return;
  restoring = true;
  state.data = parsed;
  const ids = new Set(parsed.nodes.map((n) => n.id));
  for (const c of [...state.collapsed]) if (!ids.has(c)) state.collapsed.delete(c);
  if (state.selected && !ids.has(state.selected)) state.selected = null;
  if (
    state.selectedEdge &&
    (!ids.has(state.selectedEdge.from) || !ids.has(state.selectedEdge.to))
  ) {
    state.selectedEdge = null;
  }
  if (state.focus && !ids.has(state.focus)) state.focus = null;
  clearBurst();
  window.setTimeout(() => {
    restoring = false;
  }, 0);
}

function undo(): boolean {
  if (lastUndo === null) return false;
  const cur = exportJson();
  lastRedo = cur;
  restoreTo(lastUndo);
  lastUndo = null;
  return true;
}

function redo(): boolean {
  if (lastRedo === null) return false;
  const cur = exportJson();
  lastUndo = cur;
  restoreTo(lastRedo);
  lastRedo = null;
  return true;
}

function canUndo(): boolean {
  return lastUndo !== null;
}
function canRedo(): boolean {
  return lastRedo !== null;
}

function slugify(s: string): string {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t || "";
}

function uniqueId(base: string): string {
  const ids = new Set(state.data.nodes.map((n) => n.id));
  let id = base;
  let i = 2;
  while (ids.has(id)) {
    id = `${base}-${i++}`;
  }
  return id;
}

/** fromId 是否（传递地）依赖 targetId */
function dependsOn(fromId: string, targetId: string): boolean {
  const byId = indexById(state.data.nodes);
  const seen = new Set<string>();
  const stack = [...(byId.get(fromId)?.deps ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === targetId) return true;
    const n = byId.get(id);
    if (n) stack.push(...n.deps);
  }
  return false;
}

function resetToSample() {
  state.data = structuredClone(SAMPLE_DATA);
  state.collapsed = new Set();
  state.selected = null;
  state.selectedEdge = null;
  state.filter = "all";
  state.focusFrontier = false;
  state.focus = null;
}

function resetToEmpty(project?: string) {
  state.data = { project: project || "", nodes: [] };
  state.collapsed = new Set();
  state.selected = null;
  state.selectedEdge = null;
  state.filter = "all";
  state.focusFrontier = false;
  state.focus = null;
}

/** 把某个组别登记进当前图的 groups（图自定义组别，不写死）。 */
function ensureGroup(group?: string) {
  const g = group?.trim();
  if (!g) return;
  if (!state.data.groups) state.data.groups = [];
  if (!state.data.groups.includes(g)) state.data.groups.push(g);
}

function loadJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as GraphData;
    if (!Array.isArray(parsed.nodes)) return false;
    state.data = parsed;
    state.collapsed = new Set();
    state.selected = null;
    state.selectedEdge = null;
    state.focus = null;
    return true;
  } catch {
    return false;
  }
}

function exportJson(): string {
  return JSON.stringify(state.data, null, 2);
}

function toggleCollapse(id: string) {
  if (state.collapsed.has(id)) state.collapsed.delete(id);
  else state.collapsed.add(id);
}

function expandAll() {
  state.collapsed = new Set();
}

function collapseAll() {
  state.collapsed = new Set(state.data.nodes.map((n) => n.id));
}

function selectNode(id: string | null) {
  state.selected = id;
  state.selectedEdge = null;
}

function selectEdge(e: { from: string; to: string } | null) {
  state.selectedEdge = e;
}

function addNode(input: {
  label: string;
  group?: string;
  frozen: Freeze;
  implemented: boolean;
  desc?: string;
}): string {
  const base = slugify(input.label) || `node-${state.data.nodes.length + 1}`;
  const id = uniqueId(base);
  const node: GraphNode = {
    id,
    label: input.label.trim(),
    group: input.group?.trim() || undefined,
    frozen: input.frozen,
    implemented: input.implemented,
    desc: input.desc?.trim() || undefined,
    deps: [],
    later: [],
  };
  ensureGroup(input.group);
  state.data.nodes.push(node);
  state.selected = id;
  state.selectedEdge = null;
  return id;
}

function updateNode(id: string, patch: NodePatch) {
  const n = state.data.nodes.find((x) => x.id === id);
  if (!n) return;
  if (patch.label !== undefined) n.label = patch.label;
  if (patch.group !== undefined) {
    n.group = patch.group?.trim() || undefined;
    ensureGroup(patch.group);
  }
  if (patch.frozen !== undefined) n.frozen = patch.frozen;
  if (patch.implemented !== undefined) n.implemented = patch.implemented;
  if (patch.desc !== undefined) n.desc = patch.desc?.trim() || undefined;
  if (patch.later !== undefined) n.later = patch.later.filter((t) => t.trim() !== "");
}

function removeNode(id: string) {
  state.data.nodes = state.data.nodes.filter((n) => n.id !== id);
  for (const n of state.data.nodes) {
    n.deps = n.deps.filter((d) => d !== id);
  }
  if (state.selected === id) state.selected = null;
  if (state.focus === id) state.focus = null;
}

/** nodeId 增加依赖 depId（nodeId depends on depId）。禁止自身/重复/成环。 */
function addDep(nodeId: string, depId: string): boolean {
  if (nodeId === depId) return false;
  const node = state.data.nodes.find((n) => n.id === nodeId);
  if (!node || node.deps.includes(depId)) return false;
  // 若 dep 已经依赖 node，则加边会成环
  if (dependsOn(depId, nodeId)) return false;
  node.deps.push(depId);
  return true;
}

function removeDep(nodeId: string, depId: string) {
  const node = state.data.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.deps = node.deps.filter((d) => d !== depId);
}

/** 批量写入坐标（自动布局用）。 */
function bulkSetPos(positions: Map<string, { x: number; y: number }>) {
  for (const [id, p] of positions) {
    const n = state.data.nodes.find((x) => x.id === id);
    if (n) n.pos = { x: Math.round(p.x), y: Math.round(p.y) };
  }
}

function setPos(id: string, p: { x: number; y: number }) {
  const n = state.data.nodes.find((x) => x.id === id);
  if (n) n.pos = { x: p.x, y: p.y };
}

function setFocus(id: string | null) {
  state.focus = id;
}

function addGroup(g: string) {
  ensureGroup(g);
}

/** 删除组别，并把属于它的节点组别清空。 */
function removeGroup(g: string) {
  if (!state.data.groups) return;
  state.data.groups = state.data.groups.filter((x) => x !== g);
  for (const n of state.data.nodes) {
    if (n.group === g) n.group = undefined;
  }
}

export function useStore() {
  return {
    state,
    resetToSample,
    resetToEmpty,
    loadJson,
    exportJson,
    toggleCollapse,
    expandAll,
    collapseAll,
    selectNode,
    selectEdge,
    addNode,
    updateNode,
    removeNode,
    addDep,
    removeDep,
    bulkSetPos,
    setPos,
    setFocus,
    addGroup,
    removeGroup,
    ensureGroup,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
