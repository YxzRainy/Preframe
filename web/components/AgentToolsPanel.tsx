"use client";

import type { FormEvent } from "react";
import { StatusBadge } from "./StatusBadge";

export interface CoverSummary {
  name: string;
  createdAt: string;
}

interface AgentToolsPanelProps {
  slug: string;
  isVisualPrompt: boolean;
  feedback: string;
  assetPath: string;
  coverPrompt: string;
  coverRatio: string;
  covers: CoverSummary[];
  refining: boolean;
  scanning: boolean;
  generatingCover: boolean;
  onFeedbackChange: (value: string) => void;
  onAssetPathChange: (value: string) => void;
  onCoverPromptChange: (value: string) => void;
  onCoverRatioChange: (value: string) => void;
  onRefine: (event: FormEvent<HTMLFormElement>) => void;
  onScan: (event: FormEvent<HTMLFormElement>) => void;
  onCreateCover: (event: FormEvent<HTMLFormElement>) => void;
}

const COVER_RATIOS = [
  { value: "1:1", label: "1:1 方形" },
  { value: "3:4", label: "3:4 小红书竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "9:16", label: "9:16 抖音 / 视频号" },
  { value: "16:9", label: "16:9 横屏" },
];

const REFINE_PRESETS = [
  "前三秒更抓人，减少书面感",
  "压缩篇幅，保留核心观点",
  "增加具体案例和行动建议",
  "调整为更自然的真人口播",
];

function coverUrl(slug: string, filename: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/covers/${encodeURIComponent(filename)}`;
}

function ToolIcon({ children }: { children: string }) {
  return <span className="tool-icon" aria-hidden="true">{children}</span>;
}

export function AgentToolsPanel(props: AgentToolsPanelProps) {
  const hasProject = Boolean(props.slug);
  return (
    <aside className="agent-panel">
      <header className="agent-panel-header">
        <div><span className="section-index">工具 02</span><h2>智能工具</h2><p>为当前文档调用专项能力</p></div>
        <StatusBadge tone="ready">就绪</StatusBadge>
      </header>

      <div className="agent-tool-stack">
        {props.isVisualPrompt && (
          <section className="agent-tool-card cover-tool">
            <div className="tool-card-heading"><ToolIcon>◇</ToolIcon><div><span>图片生成</span><h3>封面生成器</h3></div><i className="tool-state-dot" /></div>
            <p className="tool-description">解析视觉提示词，按指定画幅生成封面并归档。</p>
            <form onSubmit={props.onCreateCover}>
            <label className="command-field"><span>视觉指令</span><textarea required rows={5} value={props.coverPrompt} onChange={(event) => props.onCoverPromptChange(event.target.value)} placeholder="输入主体、构图、色彩和留白要求…" /></label>
              <label className="command-field"><span>输出画幅</span><select value={props.coverRatio} onChange={(event) => props.onCoverRatioChange(event.target.value)}>{COVER_RATIOS.map((ratio) => <option value={ratio.value} key={ratio.value}>{ratio.label}</option>)}</select></label>
              <button className="agent-action primary" disabled={props.generatingCover} type="submit">{props.generatingCover ? <><span className="spinner" />正在生成封面</> : <><span>✦</span> 生成封面</>}</button>
            </form>
            {props.covers.length > 0 && <div className="cover-gallery"><p>已生成封面</p>{props.covers.map((cover) => <a href={coverUrl(props.slug, cover.name)} target="_blank" rel="noreferrer" key={cover.name} title="打开原图"><img src={coverUrl(props.slug, cover.name)} alt="已生成的短视频封面" /></a>)}</div>}
          </section>
        )}

        <section className="agent-tool-card project-tools-card">
          <div className="tool-card-heading"><ToolIcon>⌘</ToolIcon><div><span>项目工具</span><h3>当前项目操作</h3></div><i className="tool-state-dot idle" /></div>
          <div className="project-tools-list">
            <details className="project-tool-details" open>
              <summary><span>修改当前文档</span><small>根据指令生成修改版</small></summary>
              <p className="tool-description compact">向当前文档下达自然语言指令，原始版本不会被覆盖。</p>
              <form onSubmit={props.onRefine}>
                <label className="command-field"><span>优化指令</span><textarea required rows={4} value={props.feedback} onChange={(event) => props.onFeedbackChange(event.target.value)} placeholder="例如：前三秒更抓人，减少书面感，保留核心观点。" /></label>
                <div className="quick-instructions" aria-label="常用优化指令">{REFINE_PRESETS.map((preset) => <button type="button" onClick={() => props.onFeedbackChange(preset)} key={preset}>{preset}</button>)}</div>
                <div className="tool-ready-line"><span className="pulse-dot" />{props.feedback ? "指令已输入，可生成修改版" : "等待优化指令"}</div>
                <button className="agent-action primary" disabled={props.refining} type="submit">{props.refining ? <><span className="spinner" />正在生成修改版</> : <><span>↗</span> 生成修改版</>}</button>
              </form>
            </details>

            <details className="project-tool-details">
              <summary><span>素材扫描</span><small>生成素材清单</small></summary>
              <p className="tool-description compact">扫描本地素材目录，生成素材清单，方便拍摄和剪辑时对照使用。</p>
              <form onSubmit={props.onScan}>
                <label className="command-field"><span>本地素材路径</span><input required value={props.assetPath} onChange={(event) => props.onAssetPathChange(event.target.value)} placeholder="/Users/name/Videos/project" /></label>
                <button className="agent-action secondary" disabled={!hasProject || props.scanning} type="submit">{!hasProject ? "请先创建内容项目" : props.scanning ? <><span className="spinner dark" />正在生成素材清单</> : <><span>⌕</span> 生成素材清单</>}</button>
              </form>
            </details>

            <div className="project-tool-row">
              <div><strong>导出 Markdown</strong><small>导出当前文档原始格式</small></div>
              <button type="button" onClick={() => document.querySelector<HTMLButtonElement>("[data-export-current]")?.click()}>导出</button>
            </div>
          </div>
        </section>

        <section className="agent-tool-card utility-card run-log-card">
          <div className="tool-card-heading"><ToolIcon>···</ToolIcon><div><span>运行记录</span><h3>任务状态</h3></div></div>
          <ul className="run-log"><li><i className="ok" /><span>项目文档读取完成</span><time>就绪</time></li><li><i className="ok" /><span>本地输出目录</span><time>正常</time></li><li><i /><span>等待下一条指令</span><time>—</time></li></ul>
        </section>
      </div>
      <footer className="agent-panel-footer"><span>本地工作区</span><span>自动保存</span></footer>
    </aside>
  );
}
