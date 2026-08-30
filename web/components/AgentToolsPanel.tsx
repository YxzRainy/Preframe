"use client";

import { ArrowClockwise, Copy } from "@phosphor-icons/react";

interface AgentToolsPanelProps {
  coverPrompt: string;
  coverRatio: string;
  regeneratingCoverPrompt: boolean;
  disabled?: boolean;
  onRegenerateCoverPrompt: () => void;
  onCoverRatioChange: (value: string) => void;
  onCopyCoverPrompt: () => void;
}

const COVER_RATIOS = [
  { value: "1:1", label: "1:1 方形" },
  { value: "3:4", label: "3:4 小红书竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "9:16", label: "9:16 抖音 / 视频号" },
  { value: "16:9", label: "16:9 横屏" },
];

/** Produces a ready-to-copy visual prompt from the project's topic and copy. */
export function AgentToolsPanel(props: AgentToolsPanelProps) {
  return (
    <aside className="agent-panel cover-generator-panel" aria-label="封面提示词">
      <section className="cover-generator-tool">
        <header className="cover-generator-header">
          <h2>封面提示词</h2>
          <p>系统根据选题、口播与发布文案自动生成；复制后交给你使用的图片工具。</p>
        </header>
        <div className="cover-prompt-heading">
          <span>自动生成的视觉提示词</span>
          <button className="cover-prompt-regenerate" type="button" disabled={props.disabled || props.regeneratingCoverPrompt} onClick={props.onRegenerateCoverPrompt}>
            {props.regeneratingCoverPrompt ? <><span className="spinner" />正在生成</> : <><ArrowClockwise size={14} weight="bold" />重新生成</>}
          </button>
        </div>
        <label className="command-field">
          <textarea readOnly rows={7} value={props.coverPrompt} placeholder="正在根据项目内容生成视觉提示词…" />
          <small>提示词会包含主体、场景、构图、光线、质感和无字文字安全区，不需要手动填写。</small>
        </label>
        <label className="command-field">
          <span>目标画幅</span>
          <select disabled={props.disabled || props.regeneratingCoverPrompt} value={props.coverRatio} onChange={(event) => props.onCoverRatioChange(event.target.value)}>
            {COVER_RATIOS.map((ratio) => <option value={ratio.value} key={ratio.value}>{ratio.label}</option>)}
          </select>
        </label>
        <button className="agent-action primary" type="button" disabled={props.disabled || props.regeneratingCoverPrompt || !props.coverPrompt} onClick={props.onCopyCoverPrompt}>
          <Copy size={16} weight="bold" />复制封面提示词
        </button>
      </section>
    </aside>
  );
}
