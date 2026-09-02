<script setup lang="ts">
import { reactive } from "vue";
import { ElMessage } from "element-plus";

import type { Freeze } from "../lib/types";

const props = defineProps<{
  modelValue: boolean;
  groups?: string[];
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "create", data: { label: string; group: string; frozen: Freeze; implemented: boolean; desc: string }): void;
}>();

const form = reactive({
  label: "",
  group: "",
  frozen: "no" as Freeze,
  implemented: false,
  desc: "",
});

function confirm() {
  if (!form.label.trim()) {
    ElMessage.warning("名称不能为空");
    return;
  }
  emit("create", { ...form });
  form.label = "";
  form.group = "";
  form.frozen = "no";
  form.implemented = false;
  form.desc = "";
  emit("update:modelValue", false);
}
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    title="新增节点"
    width="420px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="dp-form">
      <label class="dp-f">名称（唯一 id 自动生成）
        <el-input v-model="form.label" placeholder="如 resolve_skill" autofocus />
      </label>
      <label class="dp-f">组别
        <el-select v-model="form.group" filterable allow-create default-first-option clearable placeholder="python / cpp / …">
          <el-option v-for="g in props.groups ?? []" :key="g" :label="g" :value="g" />
        </el-select>
      </label>
      <label class="dp-f">冻结
        <el-select v-model="form.frozen">
          <el-option label="未冻结 (no)" value="no" />
          <el-option label="半冻结 (semi)" value="semi" />
          <el-option label="已冻结 (yes)" value="yes" />
        </el-select>
      </label>
      <label class="dp-f row">已实现
        <el-switch v-model="form.implemented" />
      </label>
      <label class="dp-f">描述
        <el-input v-model="form.desc" type="textarea" :rows="2" placeholder="一句话职责" />
      </label>
    </div>
    <template #footer>
      <el-button size="small" @click="emit('update:modelValue', false)">取消</el-button>
      <el-button size="small" type="primary" @click="confirm">创建</el-button>
    </template>
  </el-dialog>
</template>
