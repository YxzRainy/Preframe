"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NewTaskDrawer, type NewTaskFormData } from "./NewTaskDrawer";
import { ResultTabs, type ResultFile } from "./ResultTabs";
import {
  GenerationProgressModal,
  initialGenerationProgress,
  type GenerationJobView,
  type GenerationProgressItem,
  type GenerationUiStatus,
} from "./GenerationProgressModal";
import { formatDuration } from "../../src/utils/generationTiming";
import { ApiPayloadError, readEventStreamJsonResponse, readJsonResponse } from "../lib/readJsonResponse";
import { ModelConfigModal } from "./ModelConfigModal";
import { PROJECT_DOCUMENT_DEFINITIONS } from "../../src/utils/documentDefinitions";


interface GenerateResponse {
  success: boolean;
  accepted?: boolean;
  projectSlug?: string;
  projectName?: string;
  files: ResultFile[];
  status?: "complete" | "partial" | "failed";
  documentsStatus?: Record<string, { generated?: boolean; documentStatus?: string; validationErrors?: string[] }>;
  failedDocuments?: Array<{ id: string; fileName: string; validationErrors: string[] }>;
  failedStage?: string;
  error?: string;
  errorCode?: string;
  cancelled?: boolean;
  job?: GenerationJobView;
}
interface PublicModelStatus {
  providerLabel: string;
  model: string;
  configured: boolean;
  message: string;
  canConfigure: boolean;
}

const initialForm: NewTaskFormData = { projectName: "", topic: "", platform: "自动判断", contentSubject: "", contentDomain: "", style: "自动匹配", targetUser: "", extra: "", referenceMaterials: "" };
const CREATE_PROJECT_DRAFT_KEY = "piance:create-project-draft:v1";
const MODEL_CONFIGURATION_ERROR_CODES = new Set(["DEFAULT_MODEL_UNAVAILABLE", "CUSTOM_MODEL_UNAVAILABLE"]);
const TOTAL_DOCUMENTS = PROJECT_DOCUMENT_DEFINITIONS.length;
const GENERATION_STAGE_LABELS: Record<GenerationUiStatus, string> = {
  idle: "等待创建项目",
  creating: "创建项目目录",
  generatingCore: "生成创作简报",
  generatingExecution: "生成拍摄执行稿",
  generatingPublishCopy: "生成发布与复盘",
  writing: "写入本地文件",
  paused: "生成已暂停",
  partial: "部分文档已生成",
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

interface CreateProjectRequest {
  id: string;
  ideaId?: string;
  projectName?: string;
  topic?: string;
  extra?: string;
}

interface GenerateWorkspaceProps {
  presentation?: "page" | "modal";
  openRequest?: CreateProjectRequest | null;
  onOpenRequestHandled?: () => void;
}

export function GenerateWorkspace({ presentation = "page", openRequest = null, onOpenRequestHandled }: GenerateWorkspaceProps) {
  const router = useRouter();
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
  const [pausing, setPausing] = useState(false);
  const [modelLabel, setModelLabel] = useState("DeepSeek V4 Pro");
  const [modelStatus, setModelStatus] = useState<PublicModelStatus | null>(null);
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [modelConfigurationRequired, setModelConfigurationRequired] = useState(false);
  const [sourceIdeaId, setSourceIdeaId] = useState("");
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
    const data = await readJsonResponse<{ config?: { providerLabel: string; model: string; configured: boolean }; error?: string }>(response);
    if (!response.ok || !data.config) throw new Error(data.error || "生成服务状态读取失败。");
    const configured = Boolean(data.config.configured);
    const message = configured
      ? "当前浏览器的 DeepSeek Flash 已就绪"
      : "请先在模型设置中保存你自己的 DeepSeek API Key";
    setModelStatus({
      providerLabel: data.config.providerLabel,
      model: data.config.model,
      configured,
      message,
      canConfigure: true,
    });
    setModelLabel(`${data.config.providerLabel} · ${data.config.model}`);
    if (configured) setModelConfigurationRequired(false);
  }

  useEffect(() => {
    refreshModelStatus().catch(() => setModelStatus({ providerLabel: "", model: "", configured: false, message: "无法检查生成服务状态，请稍后重试。", canConfigure: false }));
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
          referenceMaterials: typeof draft.referenceMaterials === "string" ? draft.referenceMaterials : initialForm.referenceMaterials,
        });
        setDraftSaved(true);
      }
    } catch {
      window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
    } finally {
      draftHydratedRef.current = true;
    }
  }, []);

  // 灵感转换：从 URL query 预填选题主题与补充要求，并自动打开抽屉
  useEffect(() => {
    if (presentation !== "page") return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const topic = params.get("topic");
    const extra = params.get("extra");
    const projectName = params.get("projectName");
    if (!topic && !extra && !projectName) return;
    setForm((current) => ({
      ...current,
      topic: topic || current.topic,
      extra: extra || current.extra,
      projectName: projectName || current.projectName,
    }));
    setDrawerOpen(true);
    if (window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete("topic");
      url.searchParams.delete("extra");
      url.searchParams.delete("projectName");
      window.history.replaceState({}, "", url.toString());
    }
  }, [presentation]);

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
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("piance-model-config-updated", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  useEffect(() => {
    const openDrawer = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CreateProjectRequest>>).detail;
      if (detail) {
        setSourceIdeaId(detail.ideaId || "");
        setForm((current) => ({
          ...current,
          projectName: detail.projectName || current.projectName,
          topic: detail.topic || current.topic,
          extra: detail.extra || current.extra,
        }));
      }
      setDrawerOpen(true);
    };
    window.addEventListener("piance-open-new-task", openDrawer);
    return () => window.removeEventListener("piance-open-new-task", openDrawer);
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    setSourceIdeaId(openRequest.ideaId || "");
    setForm((current) => ({
      ...current,
      projectName: openRequest.projectName || current.projectName,
      topic: openRequest.topic || current.topic,
      extra: openRequest.extra || current.extra,
    }));
    setDrawerOpen(true);
    onOpenRequestHandled?.();
  }, [onOpenRequestHandled, openRequest]);

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
    const terminalStatuses = new Set<GenerationUiStatus>(["partial", "completed", "cancelled", "failed"]);
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
            const durationLabel = finishGenerationTimer(data.job);
            if ((data.job.status === "completed" || data.job.status === "partial") && data.job.projectSlug) {
              const completedFiles = data.job.files || [];
              const resultStatus = data.job.resultStatus || (data.job.status === "completed" ? "complete" : "partial");
              setFiles(completedFiles);
              setProjectSlug(data.job.projectSlug);
              setActiveName(completedFiles[0]?.name || "");
              setProjectStatus(resultStatus);
              setSuccessDurationLabel(durationLabel);
              setSuccessNotice(resultStatus === "complete");
              window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
              setDraftSaved(false);
              window.dispatchEvent(new CustomEvent("piance-current-project", { detail: {
                title: data.job.projectName || form.projectName || form.topic || "内容项目",
                status: resultStatus === "complete" ? `核心工作稿已生成 · ${completedFiles.length}/${TOTAL_DOCUMENTS} 已完成` : `部分生成 · ${completedFiles.length}/${TOTAL_DOCUMENTS} 可用`,
                tone: resultStatus === "complete" ? "ready" : "warning",
                fileCount: completedFiles.length,
              } }));
              if (presentation === "modal") router.push(`/projects/${encodeURIComponent(data.job.projectSlug)}`);
            } else if (data.job.status === "failed") {
              setErrorTitle("生成未完成");
              setError(`本次运行：${durationLabel}。${data.job.message || "后台生成失败，请检查服务端日志。"}`);
              setDrawerOpen(true);
            }
            setLoading(false);
            abortRef.current = null;
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
  }, [form.projectName, form.topic, generationJob.jobId, loading, presentation, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modelStatus?.configured) {
      setErrorTitle("尚未配置模型 API");
      setError(modelStatus?.message || "请先配置 DeepSeek API Key 后再生成。");
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
    setGenerationJob({ jobId, status: "creating", currentDocument: "01_创作简报.md", progress: 0, generationProgress: startingProgress });
    setDrawerOpen(false);
    const pendingName = form.projectName || form.topic || "内容项目";
    window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: pendingName, status: "创建项目目录", tone: "working" } }));
    let backgroundAccepted = false;
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, jobId, ideaId: sourceIdeaId || undefined }), signal: abortController.signal });
      const data = await readEventStreamJsonResponse<GenerateResponse>(response);
      if (cancelledJobIdRef.current === jobId || data.cancelled) return;
      if (data.job) {
        setGenerationJob(data.job);
        if (data.job.generationProgress?.length) setGenerationProgress(data.job.generationProgress);
      }
      if (!response.ok || !data.success) {
        const failure = new Error(data.error || "生成失败，请稍后重试。") as Error & { code?: string };
        failure.code = data.errorCode;
        throw failure;
      }
      if (data.accepted) {
        backgroundAccepted = true;
        return;
      }
      const durationLabel = finishGenerationTimer(data.job);
      const displayName = data.projectName || form.projectName || form.topic;
      const status = data.status || (data.files.length === TOTAL_DOCUMENTS ? "complete" : data.files.length ? "partial" : "failed");
      setFiles(data.files); setProjectSlug(data.projectSlug || ""); setActiveName(data.files[0]?.name || ""); setDrawerOpen(false); setSuccessNotice(true);
      setProjectStatus(status);
      setSuccessDurationLabel(durationLabel);
      setGenerationProgress(initialGenerationProgress().map((item) => {
        const documentStatus = data.documentsStatus?.[item.id];
        if (documentStatus?.generated || data.files.some((file) => file.name === item.fileName)) return { ...item, status: "completed" as const };
        return {
          ...item,
          status: documentStatus?.documentStatus === "blocked" ? "blocked" as const : "failed" as const,
          message: documentStatus?.validationErrors?.join("；"),
        };
      }));
      const failedStatus = PROJECT_DOCUMENT_DEFINITIONS
        .map((definition) => ({ definition, status: data.documentsStatus?.[definition.number] }))
        .find((item) => item.status?.documentStatus === "failed");
      const blockedCount = Object.values(data.documentsStatus || {}).filter((item) => item.documentStatus === "blocked").length;
      const failureDetail = failedStatus
        ? `${failedStatus.definition.filename}：${failedStatus.status?.validationErrors?.join("；") || "生成未通过校验"}`
        : "生成未完成";
      setGenerationIssue(status === "complete"
        ? ""
        : `本次运行已结束，用时 ${durationLabel}。${failureDetail}${blockedCount ? `；另有 ${blockedCount} 份下游文档因此未生成` : ""}。`);
      setSuccessNotice(status === "complete");
      window.localStorage.removeItem(CREATE_PROJECT_DRAFT_KEY);
      setDraftSaved(false);
      window.dispatchEvent(new CustomEvent("piance-current-project", { detail: {
        title: displayName,
        status: status === "complete" ? `核心工作稿已生成 · ${data.files.length}/${TOTAL_DOCUMENTS} 已完成` : `部分生成 · ${data.files.length}/${TOTAL_DOCUMENTS} 可用`,
        tone: status === "complete" ? "ready" : "warning",
        fileCount: data.files.length,
      } }));
      if (presentation === "modal" && data.projectSlug) router.push(`/projects/${encodeURIComponent(data.projectSlug)}`);
    } catch (caught) {
      if (cancelledJobIdRef.current === jobId || (caught instanceof DOMException && caught.name === "AbortError")) return;
      const durationLabel = finishGenerationTimer();
      setErrorTitle("生成未完成");
      setError(`本次运行：${durationLabel}。已清理临时文件。${generationErrorMessage(caught)}`);
      const needsModelConfig = caught instanceof Error && MODEL_CONFIGURATION_ERROR_CODES.has((caught as Error & { code?: string }).code || "");
      setModelConfigurationRequired(needsModelConfig);
      if (needsModelConfig) setModelConfigOpen(true);
      setDrawerOpen(true);
      window.dispatchEvent(new CustomEvent("piance-current-project", { detail: { title: "等待创建项目", status: "未创建", tone: "muted" } }));
    }
    finally {
      if (!backgroundAccepted && activeJobIdRef.current === jobId && cancelledJobIdRef.current !== jobId) {
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

  async function changePauseState(action: "pause" | "resume") {
    const jobId = activeJobIdRef.current || generationJob.jobId;
    if (!jobId) return;
    setPausing(true);
    try {
      const response = await fetch("/api/generate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const data = await readJsonResponse<{ job?: GenerationJobView; error?: string }>(response);
      if (!response.ok || !data.job) throw new Error(data.error || "生成任务状态更新失败。");
      setGenerationJob(data.job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成任务状态更新失败。");
    } finally {
      setPausing(false);
    }
  }

  const hasProject = Boolean(projectSlug);

  if (presentation === "modal") {
    return (
      <>
        <NewTaskDrawer
          open={drawerOpen}
          form={form}
          loading={loading}
          error={error}
          errorTitle={errorTitle}
          notice={cancelNotice}
          noticeTitle={cancelNoticeTitle}
          modelConfigured={Boolean(modelStatus?.configured)}
          modelStatusText={modelStatus?.message}
          canConfigureModel={Boolean(modelStatus?.canConfigure)}
          modelStatusLoading={modelStatus === null}
          draftSaved={draftSaved}
          modelConfigurationRequired={modelConfigurationRequired}
          onChange={setField}
          onSubmit={submit}
          onClose={() => setDrawerOpen(false)}
          onOpenModelConfig={() => setModelConfigOpen(true)}
          onClearDraft={clearDraft}
        />
        <ModelConfigModal open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} onSaved={() => refreshModelStatus().catch(() => undefined)} />
        <GenerationProgressModal open={loading} job={generationJob} progressItems={generationProgress} startedAt={generationStartedAt} endedAt={generationEndedAt} cancelling={cancelling} pausing={pausing} onPause={() => changePauseState("pause")} onResume={() => changePauseState("resume")} onCancel={cancelGeneration} />
      </>
    );
  }

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
                    {projectStatus === "complete" ? `${files.length}/${TOTAL_DOCUMENTS} 已完成` : projectStatus === "partial" ? `${files.length}/${TOTAL_DOCUMENTS} 可用` : "待重试"}
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
                  {projectStatus !== "complete" && <Link className="doc-bar-btn" href={`/projects/${encodeURIComponent(projectSlug)}`}>继续失败项</Link>}
                  <button className="doc-bar-btn" type="button" onClick={() => setDrawerOpen(true)}>新建项目</button>
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
        modelStatusText={modelStatus?.message}
        canConfigureModel={Boolean(modelStatus?.canConfigure)}
        modelStatusLoading={modelStatus === null}
        draftSaved={draftSaved}
        modelConfigurationRequired={modelConfigurationRequired}
        onChange={setField}
        onSubmit={submit}
        onClose={() => setDrawerOpen(false)}
        onOpenModelConfig={() => setModelConfigOpen(true)}
        onClearDraft={clearDraft}
      />
      <ModelConfigModal open={modelConfigOpen} onClose={() => setModelConfigOpen(false)} onSaved={() => refreshModelStatus().catch(() => undefined)} />
      <GenerationProgressModal open={loading} job={generationJob} progressItems={generationProgress} startedAt={generationStartedAt} endedAt={generationEndedAt} cancelling={cancelling} pausing={pausing} onPause={() => changePauseState("pause")} onResume={() => changePauseState("resume")} onCancel={cancelGeneration} />
    </main>
  );
}
