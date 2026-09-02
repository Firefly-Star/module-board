// 文件读写与“最近打开”工具。
// 优先用 File System Access API；不支持的浏览器降级为下载 / 文件选择。

export interface RecentEntry {
  name: string;
  at: string;
  data: string;
}

const LS_RECENT = "module-board:recent";

export function listRecent(): RecentEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_RECENT) ?? "[]") as RecentEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function recordRecent(name: string, data: string) {
  const arr = listRecent().filter((r) => r.name !== name);
  arr.unshift({ name, at: new Date().toISOString(), data });
  localStorage.setItem(LS_RECENT, JSON.stringify(arr.slice(0, 8)));
}

export function removeRecent(name: string) {
  localStorage.setItem(
    LS_RECENT,
    JSON.stringify(listRecent().filter((r) => r.name !== name)),
  );
}

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
  }
}

const pickerOpts = () => [
  { description: "module-board JSON", accept: { "application/json": [".json"] } },
];

/** 打开文件，返回 {text, name}；取消或失败返回 null。 */
export async function pickOpenFile(): Promise<{ text: string; name: string } | null> {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ types: pickerOpts() });
      const file = await handles[0].getFile();
      return { text: await file.text(), name: file.name };
    } catch {
      return null; // 用户取消或失败
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { text: await f.text(), name: f.name } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** 保存目标（File System Access）；不支持返回 null。取消返回 null。 */
export async function pickSaveTarget(
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  if (window.showSaveFilePicker) {
    try {
      return await window.showSaveFilePicker({ suggestedName, types: pickerOpts() });
    } catch {
      return null;
    }
  }
  return null;
}

export async function writeHandle(handle: FileSystemFileHandle, text: string) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
