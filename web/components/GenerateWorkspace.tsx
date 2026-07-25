"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { NewTaskDrawer, type NewTaskFormData } from "./NewTaskDrawer";
import { ResultTabs, type ResultFile } from "./ResultTabs";
import {
  GenerationProgressModal,
  initialGenerationProgress,
  progressFromFiles,
  type GenerationJobView,
  type GenerationProgressItem,
  type GenerationUiStatus,
} from "./GenerationProgressModal";
import { formatDuration } from "../../src/utils/generationTiming";
import { ApiPayloadError, readJsonResponse } from "../lib/readJsonResponse";
import { ModelConfigModal } from "./ModelConfigModal";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";

interface GenerateResponse { success: boolean; projectSlug: string; projectName?: string; files: ResultFile[]; partial?: boolean; failedStage?: string; error?: string; errorCode?: string; cancelled?: boolean; job?: GenerationJobView; }
interface PublicModelStatus { providerLabel: string; model: string; configured: boolean; }

const initialForm: NewTaskFormData = { projectName: "", topic: "", platform: "小红书", contentSubject: "个人博主", contentDomain: "", style: "专业但通俗", targetUser: "", extra: "" };
const CREATE_PROJECT_DRAFT_KEY = "piance:create-project-draft:v1";
const MODEL_CONFIGURATION_ERROR_CODES = new Set(["MODEL_UNAVAILABLE", "TRIAL_EXHAUSTED"]);
const TOTAL_DOCUMENTS = PROJECT_DOCUMENT_DEFINITIONS.length;
const GENERATION_STAGE_LABELS: Record<GenerationUiStatus, string> = {
  idle: "等待创建项目",
  creating: "创建项目目录",
  generatingCore: "生成前期策划文档",
  generatingExecution: "生成成片执行稿",
  generatingPublishCopy: "生成发布承接话术",
  writing: "写入本地文件",
  completed: "完成",
  cancelled: "已撤销",
  failed: "生成失败",
};

function createJobId(): string {
  return globalThis.crypto?.randomUUID?.() || `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const emptyJob: GenerationJobView = { jobId: "", status: "idle", currentDocument: "", progress: 0 };

function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiPayloadError) {
    return "生成失败：接口返回了非 JSON 内容。请检查 API 配置、模型服务或服务端日志。";
  }
  return error instanceof Error ? error.message : "生成失败，请稍后重试。";
}

export function GenerateWorkspace() {
  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState<ResultFile[]>([]);
  const [activeName, setActiveName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projectStatus, setProjectStatus] = useState<"complete" | "partial" | "failed">("complete");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generationIssue, setGenerationIssue] = useState("");
  const [cancelNotice, setCancelNotice] = useState("");
  const [cancelNoticeTitle, setCancelNoticeTitle] = useState("已撤销生成");
  const [errorTitle, setErrorTitle] = useState("生成失败");
  const [successNotice, setSuccessNotice] = useState(false);
  const [successDurationLabel, setSuccessDurationLabel] = useState("");
  const [generationJob, setGenerationJob] = useState<GenerationJobView>(emptyJob);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressItem[]>(() => initialGenerationProgress());
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationEndedAt, setGenerationEndedAt] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [modelLabel, setModelLabel] = useState("DeepSeek V4 Pro");
  const [modelStatus, setModelStatus] = useState<PublicModelStatus | null>(null);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [modelConfigurationRequired, setModelConfigurationRequired] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const activeJobIdRef = useRef("");
  const cancelledJobIdRef = useRef("");
  const generationStartedAtRef = useRef<number | null>(null);
  const draftHydratedRef = useRef(false);
  const skipNextDraftSaveRef = useRef(false);
  const setField = (name: keyof NewTaskFormData, value: string) => setForm((current) => ({ ...current, [name]: value }));

  function startGenerationTimer(): number {
    const startedAt = Date.now();
    generationStartedAtRef.current = startedAt;
    setGenerationStartedAt(startedAt);
    setGenerationEndedAt(null);
    setSuccessDurationLabel("");
    return startedAt;
  }

  function finishGenerationTimer(job?: GenerationJobView): string {
    const endedAt = Date.now();
    const startedAt = generationStartedAtRef.current || generationStartedAt || endedAt;
    setGenerationEndedAt(endedAt);
    if (job?.durationLabel) return job.durationLabel;
    return formatDuration(endedAt - startedAt);
  }

  async function refreshModelStatus() {
    const response = await fetch("/api/model-config", { cache: "no-store" });
    const data = await readJsonResponse<{ config?: PublicModelStatus; error?: string }>(response);
    if (!response.ok || !data.config) throw new Error(data.error || "模型配置读取失败。");
    setModelStatus(data.config);
    setModelLabel(`${data.config.providerLabel} · ${data.config.model}`);
    if (data.config.configured) setModelConfigurationRequired(false);
  }

  useEffect(() => {
    refreshModelStatus().catch(() => setModelStatus({ providerLabel: "", model: "", configured: false }));
    try {
      const raw = window.localStorage.getItem(CREATE_PROJECT_DRAFT_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid draft");
        const draft = parsed as Partial<Record<keyof NewTaskFormData, unknown>>;
        setForm({
          projectName: typeof draft.projectName === "string" ? draft.projectName : initialForm.projectName,
          topic: typeof draft.topic === "string" ? draft.topic : initialForm.topic,
          platform: typeof draft.platform === "string" ? draft.platform : initialForm.platform,
          contentSubject: typeof draft.contentSubject === "string" ? draft.contentSubject : initialForm.contentSubject,
          contentDomain: typeof draft.contentDomain === "string" ? draft.contentDomain : initialForm.contentDomain,
          style: typeof draft.style === "string" ? draft.style : initialForm.style,
          targetUser: typeof draft.targetUser === "string" ? draft.targetUser : initialForm.targetUser,
          extra: typeof draft.extra === "string" ? draft.extra : initialForm.extra,
        });
        setDraftSaved(true);
      }
    } catch {
      window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
    } finally {
      draftHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    if (skipNextDraftSaveRef.current) {
      skipNextDraftSaveRef.current = false;
      return;
    }
    setDraftSaved(false);
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(CREATE_PROJECT_DRAFT_KEY, JSON.stringify(form));
      setDraftSaved(true);
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [form]);

  useEffect(() => {
    const handler = (event: Event) => {
      const label = (event as CustomEvent<{ modelLabel?: string }>).detail?.modelLabel;
      if (label) setModelLabel(label);
      refreshModelStatus().catch(() => undefined);
    };
    window.addEventListener("piance-model-config-updated", handler);
    return () => window.removeEventListener("piance-model-config-updated", handler);
  }, []);

  useEffect(() => {
    const openDrawer = () => setDrawerOpen(true);
    window.addEventListener("piance-open-new-task", openDrawer);
    return () => window.removeEventListener("piance-open-new-task", openDrawer);
  }, []);

  useEffect(() => {
    if (!successNotice) return;
    const timeout = window.setTimeout(() => setSuccessNotice(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [successNotice]);

  useEffect(() => {
    if (!loading) return;
    window.dispatchEvent(new CustomEvent("piance-current-project", {
      detail: { title: form.projectName || form.topic || "内容项目", status: GENERATION_STAGE_LABELS[generationJob.status] || "生成中", tone: "working" },
    }));
  }, [form.projectName, form.topic, generationJob.status, loading]);

  useEffect(() => {
    if (!loading || !generationJob.jobId) return;
    let active = true;
    let polling = false;
    let interval: number | undefined;
    const terminalStatuses = new Set<GenerationUiStatus>(["completed", "cancelled", "failed"]);
    const poll = async () => {
      if (polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const response = await fetch(`/api/generate?jobId=${encodeURIComponent(generationJob.jobId)}`);
        const data = await readJsonResponse<{ job?: GenerationJobView }>(response);
        if (active && data.job) {
          setGenerationJob((current) => current.jobId === data.job?.jobId ? { ...current, ...data.job } : current);
          if (data.job.generationProgress?.length) setGenerationProgress(data.job.generationProgress);
          if (terminalStatuses.has(data.job.status)) {
            active = false;
            if (interval !== undefined) window.clearInterval(interval);
          }
        }
      } catch {
        // Polling is best-effort; the POST response remains authoritative.
      } finally {
        polling = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") poll();
    };
    poll();
    interval = window.setInterval(poll, 1500);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [generationJob.jobId, loading]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelStatus?.configured) {
      setErrorTitle("尚未配置模型 API");
      setError("请先配置自定义模型 API，或在服务端提供默认模型环境变量后再生成。");
      setModelConfigurationRequired(true);
      return;
    }
    setLoading(true); setError(""); setErrorTitle("生成失败"); setModelConfigurationRequired(false); setGenerationIssue(""); setCancelNotice(""); setCancelNoticeTitle("已撤销生成"); setSuccessNotice(false); setCancelling(false);
    const jobId = createJobId();
    startGenerationTimer();
    const abortController = new AbortController();
    abortRef.current = abortController;
    activeJobIdRef.current = jobId;
    cancelledJobIdRef.current = "";
    const startingProgress = initialGenerationProgress();
    setGenerationProgress(startingProgress);
    setGenerationJob({ jobId, status: "creating", currentDocument: "01_项目概览.md", progress: 0, generationProgress: startingProgress });
    setDrawerOpen(false);
    const pendingName = form.projectName || form.topic || "内容项目";
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: pendingName, status: "创建项目目录", tone: "working" } }));
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, jobId }), signal: abortController.signal });
      const data = await readJsonResponse<GenerateResponse>(response);
      if (cancelledJobIdRef.current === jobId || data.cancelled) return;
      if (data.job) {
        setGenerationJob(data.job);
        if (data.job.generationProgress?.length) setGenerationProgress(data.job.generationProgress);
      }
      if (data.partial) {
        const durationLabel = finishGenerationTimer(data.job);
        const displayName = data.projectName || form.projectName || form.topic;
        setFiles(data.files || []); setProjectSlug(data.projectSlug); setActiveName(data.files?.[0]?.name || ""); setDrawerOpen(false);
        setProjectStatus("partial");
        setGenerationProgress(progressFromFiles((data.files || []).map((file) => file.name)));
        const availableCount = data.files?.length || 0;
        const failedCount = TOTAL_DOCUMENTS - availableCount;
        setGenerationIssue(`生成未完成。本次运行：${durationLabel}。${availableCount}/${TOTAL_DOCUMENTS} 可用，${failedCount} 份需重新生成。${data.error || ""}`);
        window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: displayName, status: `部分生成 · ${availableCount}/${TOTAL_DOCUMENTS} 可用`, tone: "warning", fileCount: availableCount } }));
        return;
      }
      if (!response.ok || !data.success) {
        const failure = new Error(data.error || "生成失败，请稍后重试。") as Error & { code?: string };
        failure.code = data.errorCode;
        throw failure;
      }
      const durationLabel = finishGenerationTimer(data.job);
      const displayName = data.projectName || form.projectName || form.topic;
      setFiles(data.files); setProjectSlug(data.projectSlug); setActiveName(data.files[0]?.name || ""); setDrawerOpen(false); setSuccessNotice(true);
      setProjectStatus("complete");
      setSuccessDurationLabel(durationLabel);
      setGenerationProgress(progressFromFiles(data.files.map((file) => file.name)));
      window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
      setDraftSaved(false);
      window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: displayName, status: `策划包已生成 · ${data.files.length}/${TOTAL_DOCUMENTS} 已完成`, tone: "ready", fileCount: data.files.length } }));
    } catch (caught) {
      if (cancelledJobIdRef.current === jobId || (caught instanceof DOMException && caught.name === "AbortError")) return;
      const durationLabel = finishGenerationTimer();
      setErrorTitle("生成未完成");
      setError(`本次运行：${durationLabel}。已清理临时文件。${generationErrorMessage(caught)}`);
      setModelConfigurationRequired(caught instanceof Error && MODEL_CONFIGURATION_ERROR_CODES.has((caught as Error & { code?: string }).code || ""));
      setDrawerOpen(true);
      window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: "等待创建项目", status: "未创建", tone: "muted" } }));
    }
    finally {
      if (activeJobIdRef.current === jobId && cancelledJobIdRef.current !== jobId) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }

  function clearDraft() {
    if (!window.confirm("确定清空当前创建项目草稿吗？此操作无法撤销。")) return;
    window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
    skipNextDraftSaveRef.current = true;
    setForm(initialForm);
    setDraftSaved(false);
  }

  async function cancelGeneration() {
    const jobId = activeJobIdRef.current || generationJob.jobId;
    if (!jobId) return;
    setCancelling(true);
    cancelledJobIdRef.current = jobId;
    try {
      await fetch(`/api/generate?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" });
    } catch {
      // Abort is still useful even if the cleanup request races with the POST.
    }
    abortRef.current?.abort();
    const durationLabel = finishGenerationTimer();
    setGenerationJob({ jobId, status: "cancelled", currentDocument: "已撤销", progress: 0, message: "已撤销生成，本地临时文件已清理。" });
    setGenerationProgress(initialGenerationProgress());
    setLoading(false);
    setCancelling(false);
    setDrawerOpen(true);
    setCancelNoticeTitle("已撤销生成");
    setCancelNotice(`本次已运行：${durationLabel}。临时文件已清理。`);
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: "等待创建项目", status: "未创建", tone: "muted" } }));
  }

  const hasProject = Boolean(projectSlug && files.length);

  return (
    <main className={`home-workbench${loading ? " is-generating" : ""}${hasProject ? " has-project" : ""}`}>
      {/* 中间：文档工作区 */}
      <section className={`doc-workspace${(!hasProject && !loading) ? " doc-workspace-empty" : ""}`}>
        {/* 简洁项目栏 */}
        {(hasProject || loading) && (
          <div className="doc-project-bar">
            <div className="doc-project-bar-left">
              {hasProject ? (
                <>
                  <span className="doc-project-name">{form.projectName || form.topic || "内容项目"}</span>
                  <span className={`doc-project-status ${projectStatus}`}>
                    {projectStatus === "complete" ? `${files.length}/${TOTAL_DOCUMENTS} 已完成` : projectStatus === "partial" ? `部分可用` : "生成失败"}
                  </span>
                </>
              ) : (
                <span className="doc-project-name muted">{GENERATION_STAGE_LABELS[generationJob.status] || "生成中…"}</span>
              )}
            </div>
            <div className="doc-project-bar-right">
              {hasProject && (
                <>
                  <Link className="doc-bar-btn" href={`/projects/${encodeURIComponent(projectSlug)}`}>打开项目页</Link>
                  <button className="doc-bar-btn" type="button" onClick={() => setDrawerOpen(true)}>重新生成</button>
                  <span className="doc-bar-divider" />
                </>
              )}
            </div>
          </div>
        )}

        {/* 流程状态行 */}
        {(hasProject || loading) && (
          <div className="doc-flow-line" aria-hidden="true">
            <span className={hasProject || loading ? "done" : "active"}>选题</span>
            <i>→</i>
            <span className={loading ? "active" : hasProject ? "done" : ""}>生成</span>
            <i>→</i>
            <span className={hasProject ? "active" : ""}>修改</span>
            <i>→</i>
            <span>导出</span>
          </div>
        )}

        {/* 提示 */}
        {generationIssue && (
          <div className="doc-alert doc-alert-warning" role="alert">
            <strong>部分文档未完成</strong>
            <span>{generationIssue}</span>
          </div>
        )}
        {successNotice && (
          <div className="doc-success-toast">
            <span>✓ 共生成 {files.length} 份文档{successDurationLabel ? `，用时 ${successDurationLabel}` : ""}</span>
            <button type="button" onClick={() => setSuccessNotice(false)}>×</button>
          </div>
        )}

        {/* 文档主区：索引 + 正文 */}
        <ResultTabs
          files={files}
          activeName={activeName}
          onActiveChange={setActiveName}
          loading={loading}
          onCreateProject={() => setDrawerOpen(true)}
          modelConfigured={Boolean(modelStatus?.configured)}
        />
      </section>

      <NewTaskDrawer
        open={drawerOpen}
        form={form}
        loading={loading}
        error={error}
        errorTitle={errorTitle}
        notice={cancelNotice}
        noticeTitle={cancelNoticeTitle}
        modelConfigured={Boolean(modelStatus?.configured)}
        modelStatusLoading={modelStatus === null}
        modelStatusLabel={modelStatus?.configured ? `${modelStatus.providerLabel} · ${modelStatus.model}` : "尚未配置模型 API"}
        draftSaved={draftSaved}
        modelConfigurationRequired={modelConfigurationRequired}
        onChange={setField}
        onSubmit={submit}
        onClose={() => setDrawerOpen(false)}
        onOpenModelConfig={() => setModelConfigOpen(true)}
        onClearDraft={clearDraft}
      />
      <ModelConfigModal open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} onSaved={() => refreshModelStatus().catch(() => undefined)} />
      <GenerationProgressModal open={loading} job={generationJob} progressItems={generationProgress} startedAt={generationStartedAt} endedAt={generationEndedAt} cancelling={cancelling} onCancel={cancelGeneration} />
    </main>
  );
}
