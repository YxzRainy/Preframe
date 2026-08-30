"use client";

import type { FormEvent } from "react";
import { ArrowClockwise, Sparkle } from "@phosphor-icons/react";

export interface CoverSummary {
  name: string;
  createdAt: string;
}

interface AgentToolsPanelProps {
  slug: string;
  coverPrompt: string;
  coverRatio: string;
  covers: CoverSummary[];
  generatingCover: boolean;
  regeneratingCoverPrompt: boolean;
  disabled?: boolean;
  onCoverPromptChange: (value: string) => void;
  onRegenerateCoverPrompt: () => void;
  onCoverRatioChange: (value: string) => void;
  onCreateCover: (event: FormEvent<HTMLFormElement>) => void;
}

const COVER_RATIOS = [
  { value: "1:1", label: "1:1 方形" },
  { value: "3:4", label: "3:4 小红书竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "9:16", label: "9:16 抖音 / 视频号" },
  { value: "16:9", label: "16:9 横屏" },
];

function coverUrl(slug: string, filename: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/covers/${encodeURIComponent(filename)}`;
}

/** Shown for the current 03 发布与复盘 document or legacy visual-reference documents. */
export function AgentToolsPanel(props: AgentToolsPanelProps) {
  return (
    <aside className="agent-panel cover-generator-panel" aria-label="封面生成">
      <section className="cover-generator-tool">
        <header className="cover-generator-header">
          <h2>生成封面</h2>
          <p>根据最终发布卡或视觉参考生成封面。</p>
        </header>
        <form onSubmit={props.onCreateCover}>
          <div className="cover-prompt-heading">
            <span>视觉指令</span>
            <button className="cover-prompt-regenerate" type="button" disabled={props.disabled || props.regeneratingCoverPrompt || props.generatingCover} onClick={props.onRegenerateCoverPrompt}>
              {props.regeneratingCoverPrompt ? <><span className="spinner" />正在生成</> : <><ArrowClockwise size={14} weight="bold" />重新生成提示词</>}
            </button>
          </div>
          <label className="command-field">
            <textarea
              required
              rows={5}
              value={props.coverPrompt}
              onChange={(event) => props.onCoverPromptChange(event.target.value)}
              placeholder="点击“重新生成提示词”，或输入主体、构图、色彩和文字留白要求…"
            />
            <small>会从当前发布内容提炼视觉焦点，并生成预留文字区的无字封面背景。</small>
          </label>
          <label className="command-field">
            <span>输出画幅</span>
            <select value={props.coverRatio} onChange={(event) => props.onCoverRatioChange(event.target.value)}>
              {COVER_RATIOS.map((ratio) => <option value={ratio.value} key={ratio.value}>{ratio.label}</option>)}
            </select>
          </label>
          <button className="agent-action primary" disabled={props.disabled || props.generatingCover || props.regeneratingCoverPrompt} type="submit">
            {props.generatingCover ? <><span className="spinner" />正在生成封面</> : <><Sparkle size={16} weight="fill" />生成封面</>}
          </button>
        </form>
        {props.covers.length > 0 && (
          <div className="cover-gallery">
            {props.covers.map((cover) => (
              <a href={coverUrl(props.slug, cover.name)} target="_blank" rel="noreferrer" key={cover.name} title="打开原图">
                <img src={coverUrl(props.slug, cover.name)} alt="已生成的短视频封面" />
              </a>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
