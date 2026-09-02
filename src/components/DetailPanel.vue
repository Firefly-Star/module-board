<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { computeStatuses } from "../lib/logic";
import { useStore } from "../lib/store";
import { STATUS_META, type GraphNode } from "../lib/types";

const {
  state,
  updateNode,
  removeNode: storeRemoveNode,
  addDep,
  removeDep,
  toggleCollapse,
  setFocus,
  selectNode,
} = useStore();

const node = computed<GraphNode | null>(() =>
  state.selected ? state.data.nodes.find((n) => n.id === state.selected) ?? null : null,
);

const dependents = computed(() =>
  node.value ? state.data.nodes.filter((n) => n.deps.includes(node.value!.id)) : [],
);

const candidates = computed(() => state.data.nodes.filter((n) => n.id !== state.selected));
const groupOptions = computed(() => state.data.groups ?? []);

const meta = computed(() => {
  if (!node.value) return null;
  return STATUS_META[computeStatuses(state.data.nodes).get(node.value.id) ?? "open"];
});
const isReady = computed(() => meta.value?.label === STATUS_META.ready.label);

function patch(p: Partial<GraphNode>) {
  const n = node.value;
  if (!n) return;
  updateNode(n.id, p);
}

// ---------- 改名 ----------
const renaming = ref(false);
const nameInput = ref("");
const nameRef = ref<HTMLInputElement | null>(null);

async function startRename() {
  renaming.value = true;
  nameInput.value = node.value?.label ?? "";
  await nextTick();
  nameRef.value?.focus();
}
function commitRename() {
  renaming.value = false;
  const t = nameInput.value.trim();
  if (t && node.value && t !== node.value.label) patch({ label: t });
}

// ---------- 第二轮备注 ----------
const newLater = ref("");
function addLater() {
  const t = newLater.value.trim();
  if (!t || !node.value) return;
  patch({ later: [...(node.value.later ?? []), t] });
  newLater.value = "";
}
function setLaterAt(i: number, v: string) {
  const n = node.value;
  if (!n) return;
  const arr = [...(n.later ?? [])];
  arr[i] = v;
  patch({ later: arr });
}
function dropLater(i: number) {
  const n = node.value;
  if (!n) return;
  patch({ later: (n.later ?? []).filter((_, j) => j !== i) });
}

// ---------- 删除 ----------
async function removeNode() {
  const n = node.value;
  if (!n) return;
  try {
    await ElMessageBox.confirm(
      `删除节点「${n.label}」？其作为依赖被引用处也会一并移除。`,
      "确认删除",
      { type: "warning" },
    );
    storeRemoveNode(n.id);
    ElMessage.success("已删除");
  } catch {
    /* 取消 */
  }
}

// ---------- 依赖 ----------
const newDep = ref<string | null>(null);
function doAddDep() {
  const n = node.value;
  if (!n || !newDep.value) return;
  if (addDep(n.id, newDep.value)) ElMessage.success("已添加依赖");
  else ElMessage.warning("非法：自依赖 / 已存在 / 会成环");
  newDep.value = null;
}
</script>

<template>
  <aside v-if="node && meta" class="dp">
    <!-- 标题 / 改名 -->
    <div class="dp-head">
      <template v-if="renaming">
        <input
          ref="nameRef"
          v-model="nameInput"
          class="dp-name-input"
          @keyup.enter="commitRename"
          @blur="commitRename"
        />
      </template>
      <template v-else>
        <div class="dp-title">
          <span class="tip-dot" :style="{ background: meta.color }"></span>
          {{ node.label }}
        </div>
      </template>
      <button class="dp-x" @click="selectNode(null)">✕</button>
    </div>
    <button class="dp-rename" @click="startRename">✎ 改名</button>

    <!-- 派生状态 -->
    <div class="dp-tags">
      <span class="dp-tag" :style="{ color: meta.color, background: meta.soft }">
        {{ meta.label }}
      </span>
    </div>
    <div v-if="isReady" class="dp-ready-hint">
      依赖已齐 —— 实现完成后勾选下方「已实现」即变绿。
    </div>

    <!-- 快速属性 -->
    <div class="dp-quick">
      <label class="dp-qrow">
        <span class="dp-qlabel">已实现</span>
        <el-switch
          :model-value="node.implemented"
          @change="(v: boolean) => patch({ implemented: v })"
        />
      </label>

      <div class="dp-qrow">
        <span class="dp-qlabel">冻结</span>
        <div class="seg">
          <button
            v-for="f in (['no', 'semi', 'yes'] as const)"
            :key="f"
            class="seg-btn"
            :class="{ on: node.frozen === f }"
            @click="patch({ frozen: f })"
          >
            {{ f === "yes" ? "已冻结" : f === "semi" ? "半冻结" : "未冻结" }}
          </button>
        </div>
      </div>

      <label class="dp-qrow">
        <span class="dp-qlabel">组别</span>
        <el-select
          :model-value="node.group ?? ''"
          size="small"
          filterable
          allow-create
          default-first-option
          clearable
          placeholder="选择或输入新组别"
          style="width: 100%"
          @change="(v: string) => patch({ group: v })"
        >
          <el-option v-for="g in groupOptions" :key="g" :label="g" :value="g" />
        </el-select>
      </label>
    </div>

    <div class="dp-row dim">
      id：<code>{{ node.id }}</code>
      <span v-if="state.focus === node.id" class="dp-focus-on">聚焦中</span>
    </div>

    <!-- 描述 -->
    <div class="dp-sec">描述</div>
    <textarea
      class="dp-desc"
      :value="node.desc ?? ''"
      rows="2"
      placeholder="一句话职责"
      @change="(e: Event) => patch({ desc: (e.target as HTMLTextAreaElement).value })"
    />

    <!-- 第二轮备注（直接改） -->
    <div class="dp-sec">第二轮备注</div>
    <div v-for="(t, i) in node.later ?? []" :key="i" class="later-edit">
      <el-input :model-value="t" size="small" @change="(v: string) => setLaterAt(i, v)" />
      <button class="min-btn danger" title="删除该备注" @click="dropLater(i)">✕</button>
    </div>
    <div class="later-add">
      <el-input
        v-model="newLater"
        size="small"
        placeholder="新增备注，回车添加"
        @keyup.enter="addLater"
      />
      <button class="min-btn" @click="addLater">＋</button>
    </div>

    <!-- 依赖（除图上拖线外的次要入口） -->
    <div class="dp-sec">依赖（{{ node.deps.length }}）</div>
    <div v-if="node.deps.length" class="dep-row" v-for="d in node.deps" :key="d">
      <button class="dep-link" @click="selectNode(d)">{{ d }}</button>
      <button class="min-btn danger" title="移除该依赖(连线)" @click="removeDep(node.id, d)">✕</button>
    </div>
    <div v-if="!node.deps.length" class="dp-row dim">无依赖 —— 可用图上的「连线模式」或下方下拉添加</div>
    <div class="dep-add">
      <el-select
        v-model="newDep"
        size="small"
        filterable
        placeholder="添加依赖…"
        style="flex: 1"
      >
        <el-option v-for="c in candidates" :key="c.id" :label="`${c.label} (${c.id})`" :value="c.id" />
      </el-select>
      <button class="min-btn" @click="doAddDep">＋</button>
    </div>

    <div class="dp-sec">依赖它的（{{ dependents.length }}）</div>
    <div v-if="dependents.length" class="dp-chips">
      <button v-for="d in dependents" :key="d.id" class="dp-chip" @click="selectNode(d.id)">
        {{ d.label }}
      </button>
    </div>
    <div v-else class="dp-row dim">暂无（顶层）</div>

    <!-- 动作 -->
    <div class="dp-actions">
      <el-button size="small" @click="setFocus(state.focus === node.id ? null : node.id)">
        {{ state.focus === node.id ? "退出聚焦" : "聚焦依赖子树" }}
      </el-button>
      <el-button
        v-if="node.deps.length"
        size="small"
        @click="toggleCollapse(node.id)"
      >
        {{ state.collapsed.has(node.id) ? "展开依赖" : "折叠依赖" }}
      </el-button>
      <el-button size="small" type="danger" text @click="removeNode">删除节点</el-button>
    </div>
  </aside>
</template>
