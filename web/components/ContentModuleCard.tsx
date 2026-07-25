import type { ResultFile } from "./ResultTabs";

interface ModuleDefinition {
  name: string;
}

interface ContentModuleCardProps {
  index: number;
  definition: ModuleDefinition;
  file?: ResultFile;
  active: boolean;
  loading: boolean;
  failed?: boolean;
  onSelect: () => void;
}

export function ContentModuleCard({ index, definition, file, active, loading, failed = false, onSelect }: ContentModuleCardProps) {
  const accent = ["blue", "purple", "cyan", "teal", "gold", "indigo", "blue", "teal", "purple", "cyan"][index] || "blue";
  const state = file ? "已完成" : loading ? "生成中" : failed ? "生成失败" : "等待中";
  return (
    <button type="button" data-accent={accent} className={`surface-raised content-module-card ${active ? "active" : ""} ${loading && !file ? "loading" : ""}`} onClick={onSelect} disabled={!file}>
      <header className="module-card-header"><span className="module-number">{String(index + 1).padStart(2, "0")}</span><strong>{definition.name}</strong></header>
      <footer><span className="module-status"><i />{state}</span><b className="module-action">打开文档</b></footer>
    </button>
  );
}
