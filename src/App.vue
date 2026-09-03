<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import DetailPanel from "./components/DetailPanel.vue";
import GraphView from "./components/GraphView.vue";
import NodeDialog from "./components/NodeDialog.vue";
import {
  desktopBridge,
  desktopOpen,
  desktopSave,
  desktopSaveAs,
  downloadText,
  listRecent,
  pickOpenFile,
  pickSaveTarget,
  recordRecent,
  removeRecent,
  writeHandle,
  type RecentEntry,
} from "./lib/fileio";
import {
  autoLayout,
  computeDependencyClosure,
  computeFrontier,
  computeStatuses,
  computeVisible,
  revealDelta,
} from "./lib/logic";
import { useStore } from "./lib/store";
import { STATUS_META, type Freeze, type Status } from "./lib/types";

const {
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
  addDep,
  removeDep,
  bulkSetPos,
  setPos,
  setFocus,
  addGroup,
  removeGroup,
  undo,
  redo,
  canUndo,
  canRedo,
} = useStore();

// ---------- 视图 ----------
const gv = ref<InstanceType<typeof GraphView> | null>(null);
const showDetail = ref(true);
const showAdd = ref(false);
const showGroups = ref(false);
const showJson = ref(false);
const newGroupName = ref("");

const byId = computed(() => new Map(state.data.nodes.map((n) => [n.id, n])));
const visible = computed(() => computeVisible(state.data.nodes, state.collapsed));
const frontier = computed(() => computeFrontier(state.data.nodes));
const statuses = computed(() => computeStatuses(state.data.nodes));

const focusClosure = computed(() =>
  state.focus ? computeDependencyClosure(state.data.nodes, state.focus) : null,
);

const collapseCounts = computed(() => {
  const m = new Map<string, number>();
  for (const id of state.collapsed) m.set(id, revealDelta(state.data.nodes, state.collapsed, id));
  return m;
});

const visibleNodes = computed(() =>
  state.data.nodes.filter((n) => {
    if (!visible.value.has(n.id)) return false;
    const st = statuses.value.get(n.id);
    if (state.filter !== "all" && st !== state.filter) return false;
    if (focusClosure.value && !focusClosure.value.has(n.id)) return false;
    return true;
  }),
);

const selectedNode = computed(() =>
  state.selected ? byId.value.get(state.selected) ?? null : null,
);

const statusCount = (s: Status) => {
  let c = 0;
  for (const st of statuses.value.values()) if (st === s) c++;
  return c;
};

const focusLabel = computed(() =>
  state.focus ? byId.value.get(state.focus)?.label ?? state.focus : "",
);

const groupList = computed(() =>
  (state.data.groups ?? []).map((g) => ({
    name: g,
    count: state.data.nodes.filter((n) => n.group === g).length,
  })),
);

function addGroupFromInput() {
  const g = newGroupName.value.trim();
  if (!g) return;
  addGroup(g);
  newGroupName.value = "";
  ElMessage.success(`已添加组别「${g}」`);
}

async function removeGroupWithConfirm(g: string) {
  try {
    await ElMessageBox.confirm(
      `删除组别「${g}」？属于它的节点会清空组别（节点本身保留）。`,
      "确认删除组别",
      { type: "warning" },
    );
    removeGroup(g);
    ElMessage.success(`已删除组别「${g}」`);
  } catch {
    /* 取消 */
  }
}

// ---------- 当前 JSON 视图（跟随当前面板状态的实时序列化） ----------
const jsonText = computed(() => JSON.stringify(state.data, null, 2));

async function copyJson() {
  const text = jsonText.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    ElMessage.success("已复制当前 JSON");
  } catch {
    ElMessage.error("复制失败");
  }
}

function downloadCurrentJson() {
  downloadText(`${state.data.project || "module-board"}.json`, jsonText.value);
  ElMessage.success("已下载当前 JSON");
}

// ---------- 文件（打开/保存/另存为/新建/最近 + 未保存修改） ----------
type AskResult = "cancel" | "save" | "saveAs" | "discard";

const fileName = ref<string | null>(null);
const fileHandle = ref<FileSystemFileHandle | null>(null);
const desktopPath = ref<string | null>(null); // Electron 桌面模式下的当前文件绝对路径
const dirty = ref(false);
const ask = ref<{ res: (r: AskResult) => void } | null>(null);
const recentList = ref<RecentEntry[]>(listRecent());

let savedSnapshot = exportJson();

function respond(r: AskResult) {
  ask.value?.res(r);
  ask.value = null;
}

function markClean() {
  savedSnapshot = JSON.stringify(state.data);
  dirty.value = false;
}

// dirty 判断：任何数据改动都会与“上次落盘快照”不一致
watch(
  () => JSON.stringify(state.data),
  (val) => {
    dirty.value = val !== savedSnapshot;
  },
);

function refreshRecent() {
  recentList.value = listRecent();
}

function askSave(): Promise<AskResult> {
  return new Promise((res) => {
    ask.value = { res };
  });
}

async function ensureClean(): Promise<boolean> {
  if (!dirty.value) return true;
  const r = await askSave();
  if (r === "cancel") return false;
  if (r === "discard") return true;
  return await saveCurrent(r === "saveAs");
}

async function saveCurrent(forceAs: boolean): Promise<boolean> {
  const text = exportJson();
  const name = fileName.value || `${state.data.project || "module-board"}.json`;
  if (desktopBridge) {
    if (!forceAs && desktopPath.value) {
      const ok = await desktopSave(desktopPath.value, text);
      if (!ok) return false;
      recordRecent(name, text);
      markClean();
      ElMessage.success(`已保存 ${name}`);
      return true;
    }
    const r = await desktopSaveAs(name, text);
    if (!r) return false; // 用户取消
    desktopPath.value = r.path;
    fileName.value = r.name;
    recordRecent(r.name, text);
    markClean();
    ElMessage.success(`已保存 ${r.name}`);
    return true;
  }
  if (!forceAs && fileHandle.value) {
    await writeHandle(fileHandle.value, text);
    recordRecent(name, text);
    markClean();
    return true;
  }
  const handle = await pickSaveTarget(name);
  if (handle) {
    await writeHandle(handle, text);
    fileHandle.value = handle;
    fileName.value = handle.name;
    recordRecent(handle.name, text);
    markClean();
    ElMessage.success(`已保存 ${handle.name}`);
    return true;
  }
  // 无 File System Access → 降级下载
  downloadText(name, text);
  fileName.value = name;
  fileHandle.value = null;
  recordRecent(name, text);
  markClean();
  ElMessage.success(`已导出 ${name}`);
  return true;
}

function loadFromText(text: string, name: string) {
  if (!loadJson(text)) {
    ElMessage.error("JSON 格式不正确，未载入");
    return false;
  }
  fileName.value = name;
  fileHandle.value = null;
  desktopPath.value = null;
  markClean();
  recordRecent(name, text);
  refreshRecent();
  return true;
}

async function onNew() {
  if (!(await ensureClean())) return;
  resetToEmpty(state.data.project);
  fileName.value = null;
  fileHandle.value = null;
  desktopPath.value = null;
  markClean();
  selectNode(null);
}

async function onOpen() {
  if (!(await ensureClean())) return;
  if (desktopBridge) {
    const r = await desktopOpen();
    if (r && loadFromText(r.text, r.name)) desktopPath.value = r.path;
    return;
  }
  const f = await pickOpenFile();
  if (f) loadFromText(f.text, f.name);
}

async function onSave() {
  await saveCurrent(false);
}

async function onSaveAs() {
  await saveCurrent(true);
}

async function onLoadExample() {
  if (!(await ensureClean())) return;
  resetToSample();
  fileName.value = null;
  fileHandle.value = null;
  desktopPath.value = null;
  markClean();
  refreshRecent();
}

async function onRecentOpen(r: RecentEntry) {
  if (!(await ensureClean())) return;
  loadFromText(r.data, r.name);
}

function onRecentRemove(name: string) {
  removeRecent(name);
  refreshRecent();
}

function onKey(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "s") {
    e.preventDefault();
    void saveCurrent(false);
    return;
  }
  if (mod && k === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && k === "y") {
    e.preventDefault();
    redo();
  }
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("beforeunload", onBeforeUnload);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("beforeunload", onBeforeUnload);
});

// ---------- 其它工具栏动作 ----------
function toggleFrontier() {
  state.focusFrontier = !state.focusFrontier;
  if (state.focusFrontier) expandAll();
}

/** 一键自动布局（dagre）并写入坐标；之后仍可手动拖动微调。 */
function autoLayoutAll() {
  const ids = new Set(state.data.nodes.map((n) => n.id));
  const res = autoLayout(state.data.nodes, ids);
  bulkSetPos(res.pos);
  requestAnimationFrame(() => gv.value?.fitView());
}

/** 给还没有 pos 的节点补一个 dagre 默认位置（不覆盖已有手动坐标）。 */
function fillMissingPos() {
  const missingNodes = state.data.nodes.filter((n) => !n.pos);
  if (!missingNodes.length) return;
  const ids = new Set(state.data.nodes.map((n) => n.id));
  const res = autoLayout(state.data.nodes, ids);
  for (const node of missingNodes) {
    const p = res.pos.get(node.id);
    if (p) setPos(node.id, { x: p.x, y: p.y });
  }
}

watch(
  () => state.data.nodes.map((n) => n.id).join(","),
  () => fillMissingPos(),
  { immediate: true },
);

function onMove(id: string, x: number, y: number) {
  setPos(id, { x, y });
}

function onCreate(data: {
  label: string;
  group: string;
  frozen: Freeze;
  implemented: boolean;
  desc: string;
}) {
  addNode({
    label: data.label,
    group: data.group || undefined,
    frozen: data.frozen,
    implemented: data.implemented,
    desc: data.desc || undefined,
  });
  showDetail.value = true;
  ElMessage.success(`已新增：${data.label}`);
}

function deleteSelectedEdge() {
  const e = state.selectedEdge;
  if (!e) return;
  removeDep(e.to, e.from);
  selectEdge(null);
  ElMessage.success("已删除连线");
}

function deleteEdgeByEvent(e: { from: string; to: string }) {
  removeDep(e.to, e.from);
  selectEdge(null);
  ElMessage.success("已删除连线（撤销：Ctrl+Z）");
}

function onConnect(dependent: string, dependency: string) {
  if (dependent === dependency) {
    ElMessage.warning("不能依赖自己");
    return;
  }
  if (addDep(dependent, dependency)) {
    ElMessage.success(`「${dependency}」→ 「${dependent}」（后者依赖前者）`);
  } else {
    ElMessage.warning("非法：已存在该依赖，或会成环");
  }
}

function shortTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const displayName = computed(
  () => fileName.value || state.data.project || "未命名",
);
</script>

<template>
  <div class="app">
    <header class="top">
      <div class="brand">
        <div class="logo">◈</div>
        <div class="brand-text">
          <div class="brand-name">
            module-board<span v-if="dirty" class="dirty-dot" title="有未保存修改">●</span>
          </div>
          <div class="brand-sub">{{ displayName }}</div>
        </div>
      </div>

      <div class="toolbar">
        <el-button size="small" @click="onNew">新建</el-button>
        <el-button size="small" @click="onOpen">打开</el-button>
        <el-button size="small" type="primary" plain @click="onSave">保存</el-button>
        <el-button size="small" @click="onSaveAs">另存为</el-button>

        <el-popover trigger="click" placement="bottom-start" :width="300">
          <template #reference>
            <el-button size="small">
              最近<span class="caret">▾</span>
            </el-button>
          </template>
          <div class="recent-pop">
            <div v-if="!recentList.length" class="recent-empty">暂无最近文件</div>
            <div v-for="r in recentList" :key="r.name" class="recent-row">
              <button class="recent-main" @click="onRecentOpen(r)">
                <span class="recent-name">{{ r.name }}</span>
                <span class="recent-time">{{ shortTime(r.at) }}</span>
              </button>
              <button class="recent-x" title="移除记录" @click="onRecentRemove(r.name)">✕</button>
            </div>
            <button class="recent-example" @click="onLoadExample">载入示例数据</button>
          </div>
        </el-popover>

        <span class="tb-sep" />

        <el-select
          :model-value="state.filter"
          size="small"
          class="tb-filter"
          @change="(v: any) => (state.filter = v)"
        >
          <el-option label="全部状态" value="all" />
          <el-option :label="STATUS_META.open.label" value="open" />
          <el-option :label="STATUS_META.frozen.label" value="frozen" />
          <el-option :label="STATUS_META.ready.label" value="ready" />
          <el-option :label="STATUS_META.implemented.label" value="implemented" />
        </el-select>

        <el-button size="small" :type="state.focusFrontier ? 'primary' : 'default'" @click="toggleFrontier">
          下一步实现
        </el-button>
        <el-button size="small" @click="autoLayoutAll">自动布局</el-button>
        <el-button size="small" @click="showGroups = true">组别</el-button>
        <el-button size="small" @click="showJson = true">JSON</el-button>
        <el-button size="small" :disabled="!canUndo()" @click="undo">撤销</el-button>
        <el-button size="small" :disabled="!canRedo()" @click="redo">重做</el-button>
        <el-button size="small" type="success" plain @click="showAdd = true">新增节点</el-button>
        <el-button size="small" @click="expandAll">展开全部</el-button>
        <el-button size="small" @click="collapseAll">折叠全部</el-button>
        <el-button size="small" @click="gv?.fitView()">复位视图</el-button>
      </div>

      <button v-if="selectedNode" class="top-detail-toggle" @click="showDetail = !showDetail">
        {{ showDetail ? "收起详情" : "展开详情" }}
      </button>
    </header>

    <main class="main" :class="{ 'dp-open': showDetail && selectedNode }">
      <section class="graph-pane">
        <GraphView
          ref="gv"
          :nodes="visibleNodes"
          :collapsed="state.collapsed"
          :selected="state.selected"
          :selected-edge="state.selectedEdge"
          :frontier="frontier"
          :focus-frontier="state.focusFrontier"
          :collapse-counts="collapseCounts"
          :statuses="statuses"
          @select="selectNode"
          @select-edge="selectEdge"
          @toggle-collapse="toggleCollapse"
          @move-node="onMove"
          @connect="onConnect"
          @delete-edge="deleteEdgeByEvent"
        />

        <div class="legend">
          <span
            v-for="s in (['open', 'frozen', 'ready', 'implemented'] as const)"
            :key="s"
            class="legend-item"
          >
            <span class="legend-dot" :style="{ background: STATUS_META[s].color }"></span>
            {{ STATUS_META[s].label }} {{ statusCount(s) }}
          </span>
          <span class="legend-sep" />
          <span class="legend-total">共 {{ state.data.nodes.length }} 模块</span>
        </div>

        <div class="hint">拖动节点 · 从节点右端圆点拖出连线（吸附入口）· 滚轮缩放 · 双击复位</div>

        <Transition name="fade">
          <div v-if="state.focusFrontier && !state.focus" class="frontier-banner">
            高亮节点 = 依赖已齐、现在可开始实现
          </div>
        </Transition>
        <Transition name="fade">
          <div v-if="state.focus" class="frontier-banner focus">
            聚焦「{{ focusLabel }}」的依赖子树
            <button class="banner-x" @click="setFocus(null)">退出</button>
          </div>
        </Transition>
      </section>

      <Transition name="slide">
        <div v-if="showDetail && selectedNode" class="detail-holder">
          <DetailPanel />
        </div>
      </Transition>

      <Transition name="pop">
        <div v-if="state.selectedEdge" class="edge-bar">
          选中连线：<code>{{ state.selectedEdge.from }} → {{ state.selectedEdge.to }}</code>
          <el-button size="small" type="danger" plain @click="deleteSelectedEdge">删除该连线</el-button>
          <el-button size="small" text @click="selectEdge(null)">取消</el-button>
        </div>
      </Transition>
    </main>

    <!-- 当前 JSON 实时视图 -->
    <el-dialog
      :model-value="showJson"
      title="当前 JSON（实时，跟随面板所有未保存修改）"
      width="min(720px, 94vw)"
      append-to-body
      top="6vh"
      @update:model-value="(v: boolean) => (showJson = v)"
    >
      <pre class="json-view">{{ jsonText }}</pre>
      <template #footer>
        <span class="json-hint">这是当前状态导出的 JSON——不是打开时那个未修改的旧文件内容。</span>
        <el-button size="small" @click="copyJson">复制</el-button>
        <el-button size="small" type="primary" plain @click="downloadCurrentJson">下载当前 JSON</el-button>
      </template>
    </el-dialog>

    <!-- 未保存修改询问框 -->
    <el-dialog
      :model-value="!!ask"
      title="有未保存的修改"
      width="380px"
      append-to-body
      @update:model-value="(v: boolean) => !v && (ask = null)"
    >
      <p class="ask-text">当前修改尚未保存，要继续吗？</p>
      <template #footer>
        <el-button size="small" @click="respond('cancel')">取消</el-button>
        <el-button size="small" @click="respond('saveAs')">另存为…</el-button>
        <el-button size="small" type="primary" @click="respond('save')">保存</el-button>
        <el-button size="small" type="danger" plain @click="respond('discard')">丢弃修改</el-button>
      </template>
    </el-dialog>

    <NodeDialog v-model="showAdd" :groups="state.data.groups ?? []" @create="onCreate" />

    <!-- 组别管理 -->
    <el-dialog
      :model-value="showGroups"
      title="组别管理"
      width="420px"
      append-to-body
      @update:model-value="(v: boolean) => (showGroups = v)"
    >
      <div v-if="!groupList.length" class="dp-row dim">
        还没有组别。可在这里添加，或在节点详情的「组别」里输入新组别（自动登记）。
      </div>
      <div v-for="g in groupList" :key="g.name" class="grp-row">
        <span class="grp-name">{{ g.name }}</span>
        <span class="grp-count">{{ g.count }} 个节点</span>
        <button class="min-btn danger" title="删除该组别" @click="removeGroupWithConfirm(g.name)">
          ✕
        </button>
      </div>
      <div class="dep-add">
        <el-input
          v-model="newGroupName"
          size="small"
          placeholder="新增组别，回车添加"
          @keyup.enter="addGroupFromInput"
        />
        <button class="min-btn" @click="addGroupFromInput">＋</button>
      </div>
    </el-dialog>
  </div>
</template>
