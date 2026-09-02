// 数据模型：module-board 的真相源格式
// 边由 node.deps 推导：dependency → dependent（支撑方向，靠左 = 底层）

export type Freeze = "no" | "semi" | "yes";

export type Status = "open" | "frozen" | "ready" | "implemented";

export interface NodePos {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  label: string;
  group?: string; // 展示分组，如 "python" / "cpp"
  frozen: Freeze;
  implemented: boolean;
  desc?: string;
  deps: string[]; // 依赖的 node id
  later?: string[]; // 第二轮备注（整体完成后还想改的点）
  pos?: NodePos; // 手动布局坐标（中心），仅手动模式使用；自动模式由 dagre 决定
}

export interface GraphData {
  project?: string;
  /** 本图自定义的组别清单（如 cpp / python，完全由用户决定） */
  groups?: string[];
  nodes: GraphNode[];
}

export type LayoutMode = "auto" | "manual";

export interface NodePatch {
  label?: string;
  group?: string;
  frozen?: Freeze;
  implemented?: boolean;
  desc?: string;
  later?: string[];
}

export function freezeLabel(f: Freeze): string {
  return f === "yes" ? "已冻结" : f === "semi" ? "半冻结" : "未冻结";
}

export const STATUS_META: Record<Status, { label: string; color: string; soft: string }> = {
  implemented: { label: "已实现", color: "#10b981", soft: "#ecfdf5" },
  ready: { label: "依赖已齐·待实现", color: "#7c3aed", soft: "#f5f3ff" },
  frozen: { label: "已冻结·未实现", color: "#3b82f6", soft: "#eff6ff" },
  open: { label: "未冻结·未实现", color: "#f59e0b", soft: "#fffbeb" },
};
