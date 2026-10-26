"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PublicShell } from "@/components/platform/public-shell";
import {
  CodeBlock,
  DecisionBadge,
  ErrorBlock,
  Field,
  LoadingBlock,
  MockBadge,
  PrototypeBanner,
  SimpleSelect,
  useFormatters,
} from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TestReport } from "@/components/platform/test-report";
import { consumePlaygroundQuota, moderationLimits } from "@/lib/platform/limits";
import { useSession } from "@/lib/platform/session";
import { usePrototypeStore } from "@/lib/platform/store";
import {
  buildImageResponse,
  buildInvalidResponse,
  buildQuotaResponse,
  buildTextResponse,
  prettyJson,
  type ImageSampleId,
  type TextSampleId,
} from "@/lib/platform/moderation";
import type { Decision, ModerationResponse } from "@/lib/platform/types";
import { cn } from "@/lib/utils";

const textSamples: Array<TextSampleId | "custom"> = ["safe", "risk", "review", "outage", "custom"];
const imageSamples: ImageSampleId[] = ["safe", "risk", "review", "outage"];

export function PlaygroundView() {
  const t = useTranslations("Play");
  const [mode, setMode] = useState<"text" | "image">("text");

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
              <MockBadge />
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{t("description")}</p>
          </div>
        </div>
        <div className="mt-4">
          <PrototypeBanner>{t("dataNotice")}</PrototypeBanner>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant={mode === "text" ? "default" : "outline"}
            onClick={() => setMode("text")}
          >
            {t("textMode")}
          </Button>
          <Button
            variant={mode === "image" ? "default" : "outline"}
            onClick={() => setMode("image")}
          >
            {t("imageMode")}
          </Button>
        </div>
        <div className="mt-6">{mode === "text" ? <TextLab /> : <ImageLab />}</div>
      </div>
    </PublicShell>
  );
}

function TextLab() {
  const t = useTranslations("Play");
  const catalog = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const ops = useTranslations("Ops");
  const store = usePrototypeStore();
  const { session } = useSession();
  const [sample, setSample] = useState<TextSampleId | "custom">("review");
  const [text, setText] = useState(t("samples.review"));
  const [sceneId, setSceneId] = useState("default");
  const [expected, setExpected] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ModerationResponse | null>(null);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (sample === "custom") return;
    setText(t(`samples.${sample}`));
  }, [sample, t]);

  const request = useMemo(
    () => ({
      text,
      scene_id: sceneId,
      metadata: { source: "playground" },
    }),
    [sceneId, text]
  );

  async function run() {
    setFormError("");
    if (!text.trim()) {
      setFormError(t("textRequired"));
      setResult(null);
      return;
    }
    setLoading(true);
    setResult(null);
    await wait(500);
    if (text.length > moderationLimits.textMaxChars) {
      setResult(
        buildInvalidResponse({
          sceneId,
          reason: t("reasons.tooLong"),
          errorMessage: t("reasons.tooLong"),
          errorCode: 400,
        })
      );
      setLoading(false);
      return;
    }
    const quota = consumePlaygroundQuota();
    if (!quota.ok) {
      setResult(
        buildQuotaResponse({
          sceneId,
          reason: t("reasons.rateLimit", { seconds: quota.retryAfterSec }),
          errorMessage: t("reasons.rateLimit", { seconds: quota.retryAfterSec }),
        })
      );
      setLoading(false);
      return;
    }
    const chosen = sample === "custom" ? null : sample;
    const reasonKey =
      chosen === "outage" || text.toLowerCase().includes("demo_outage")
        ? "outage"
        : chosen === "risk" || text.toLowerCase().includes("demo_block_token")
          ? "risk"
          : chosen === "review" || text.toLowerCase().includes("demo_review_token")
            ? "review"
            : chosen === "safe"
              ? "safe"
              : "safe";
    const response = buildTextResponse({
      sample: chosen,
      text,
      sceneId,
      reason: t(`reasons.${reasonKey}`),
      errorMessage: t("reasons.outage"),
    });
    setResult(response);
    if (
      session &&
      store.state.storageByTenant[session.tenantId] &&
      response.status === "success"
    ) {
      store.rememberSample({
        id: response.request_id,
        tenantId: session.tenantId,
        kind: "text",
        excerpt: text.slice(0, 120),
        createdAt: new Date().toISOString(),
      });
    }
    setLoading(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-2">
          {textSamples.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSample(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                sample === id
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-200 text-slate-600"
              )}
            >
              {t(`sampleNames.${id}`)}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">{ops("playgroundPrompt")}</p>
        <div className="mt-4 space-y-4">
          <Field label={t("scene")}>
            <SimpleSelect
              value={sceneId}
              onChange={setSceneId}
              options={[
                { value: "default", label: t("scenes.default") },
                { value: "scene_ugc", label: t("scenes.ugc") },
                { value: "scene_ai_io", label: t("scenes.ai") },
              ]}
            />
          </Field>
          <Field label={catalog("expected")}>
            <SimpleSelect
              value={expected || "unset"}
              onChange={(value) => setExpected(value === "unset" ? "" : value)}
              options={[
                { value: "unset", label: catalog("noExpected") },
                ...(["allow", "block", "review"] as Decision[]).map((item) => ({ value: item, label: enums(`decision.${item}`) })),
              ]}
            />
          </Field>
          <Field label={t("textInput")} hint={t("textHint", { max: moderationLimits.textMaxChars })}>
            <Textarea
              value={text}
              onChange={(event) => {
                setSample("custom");
                setText(event.target.value);
              }}
              className="min-h-40"
            />
          </Field>
          {formError ? <ErrorBlock title={t("inputError")} description={formError} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={run} disabled={loading}>
              {loading ? t("running") : t("run")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setText("");
                setSample("custom");
                setResult(null);
                setFormError("");
              }}
            >
              {t("clear")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSample("review");
                setText(t("samples.review"));
                setSceneId("default");
                setResult(null);
                setFormError("");
              }}
            >
              {t("reset")}
            </Button>
          </div>
        </div>
      </section>
      <ResultPanel
        loading={loading}
        result={result}
        request={request}
        empty={t("emptyResult")}
      />
      {result ? (
        <div className="lg:col-span-2">
          <TestReport
            source="playground-text"
            sceneId={sceneId}
            cases={[{
              input: text,
              expected,
              decision: result.decision ?? "",
              status: result.status,
              capabilityIds: ["cap_text_small"],
            }]}
          />
        </div>
      ) : null}
    </div>
  );
}

function ImageLab() {
  const t = useTranslations("Play");
  const catalog = useTranslations("Catalog");
  const enums = useTranslations("Enums");
  const format = useFormatters();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sample, setSample] = useState<ImageSampleId>("safe");
  const [sceneId, setSceneId] = useState("default");
  const [expected, setExpected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ModerationResponse | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function applyFile(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setResult(null);
    if (!next) {
      setFile(null);
      setPreview(null);
      setFileError("");
      return;
    }
    const allowed = moderationLimits.imageMimeTypes.includes(
      next.type as (typeof moderationLimits.imageMimeTypes)[number]
    );
    if (!allowed) {
      setFile(next);
      setPreview(null);
      setFileError(t("unsupportedType"));
      return;
    }
    if (next.size > moderationLimits.imageMaxBytes) {
      setFile(next);
      setPreview(null);
      setFileError(t("fileTooLarge", { size: format.bytes(moderationLimits.imageMaxBytes) }));
      return;
    }
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setFileError("");
  }

  const request = {
    filename: file?.name ?? null,
    content_type: file?.type || null,
    size_bytes: file?.size ?? null,
    scene_id: sceneId,
    metadata: { source: "playground", storage: "browser-preview-only" },
  };

  async function run() {
    if (!file) {
      setFileError(t("fileRequired"));
      setResult(null);
      return;
    }
    if (fileError && !preview) {
      const code = file.size > moderationLimits.imageMaxBytes ? 413 : 400;
      setResult(
        buildInvalidResponse({
          sceneId,
          reason: fileError,
          errorMessage: fileError,
          errorCode: code,
        })
      );
      return;
    }
    setLoading(true);
    setResult(null);
    await wait(600);
    const quota = consumePlaygroundQuota();
    if (!quota.ok) {
      setResult(
        buildQuotaResponse({
          sceneId,
          reason: t("reasons.rateLimit", { seconds: quota.retryAfterSec }),
          errorMessage: t("reasons.rateLimit", { seconds: quota.retryAfterSec }),
        })
      );
      setLoading(false);
      return;
    }
    setResult(
      buildImageResponse({
        sample,
        sceneId,
        reason: t(`imageReasons.${sample}`),
        errorMessage: t("imageReasons.outage"),
      })
    );
    setLoading(false);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap gap-2">
          {imageSamples.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSample(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                sample === id
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-200 text-slate-600"
              )}
            >
              {t(`imageSampleNames.${id}`)}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-4">
          <Field label={t("scene")}>
            <SimpleSelect
              value={sceneId}
              onChange={setSceneId}
              options={[
                { value: "default", label: t("scenes.default") },
                { value: "scene_ugc", label: t("scenes.ugc") },
                { value: "scene_ai_io", label: t("scenes.ai") },
              ]}
            />
          </Field>
          <input
            ref={inputRef}
            type="file"
            accept={moderationLimits.imageMimeTypes.join(",")}
            className="hidden"
            onChange={(event) => {
              applyFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <div className="rounded-xl border border-dashed border-slate-300 p-4">
            {preview ? (
              // Local object URL only. The file is not uploaded.
              <img src={preview} alt={t("previewAlt")} className="max-h-56 rounded-md object-contain" />
            ) : (
              <p className="text-sm text-slate-500">{t("dropHint")}</p>
            )}
            {file ? (
              <p className="mt-3 text-xs text-slate-600">
                {file.name} · {file.type || t("unknownType")} · {format.bytes(file.size)}
              </p>
            ) : null}
            {fileError ? <p className="mt-2 text-sm text-red-600">{fileError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                {file ? t("replaceImage") : t("chooseImage")}
              </Button>
              {file ? (
                <Button type="button" variant="outline" onClick={() => applyFile(null)}>
                  {t("removeImage")}
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            {t("imageLimits", {
              types: moderationLimits.imageExtensions.join(", "),
              size: format.bytes(moderationLimits.imageMaxBytes),
              timeout: format.number(moderationLimits.requestTimeoutMs),
            })}
          </p>
          <Field label={catalog("expected")}>
            <SimpleSelect
              value={expected || "unset"}
              onChange={(value) => setExpected(value === "unset" ? "" : value)}
              options={[
                { value: "unset", label: catalog("noExpected") },
                ...(["allow", "block", "review"] as Decision[]).map((item) => ({ value: item, label: enums(`decision.${item}`) })),
              ]}
            />
          </Field>
          <Button onClick={run} disabled={loading}>
            {loading ? t("running") : t("run")}
          </Button>
        </div>
      </section>
      <ResultPanel loading={loading} result={result} request={request} empty={t("emptyResult")} />
      {result ? (
        <div className="lg:col-span-2">
          <TestReport
            source="playground-image"
            sceneId={sceneId}
            inputType="image"
            cases={[{
              input: file?.name || sample,
              expected,
              decision: result.decision ?? "",
              status: result.status,
              capabilityIds: ["cap_image_small"],
            }]}
          />
        </div>
      ) : null}
    </div>
  );
}

function ResultPanel({
  loading,
  result,
  request,
  empty,
}: {
  loading: boolean;
  result: ModerationResponse | null;
  request: unknown;
  empty: string;
}) {
  const t = useTranslations("Play");
  const format = useFormatters();
  if (loading) return <LoadingBlock label={t("running")} />;
  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        {empty}
      </div>
    );
  }
  const failed = result.status === "error";
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <MockBadge />
          <DecisionBadge value={failed ? null : result.decision} />
          <span className="text-xs text-slate-500">{result.status}</span>
        </div>
        {failed ? (
          <div className="mt-3">
            <ErrorBlock
              title={t("serviceError", { code: result.error_code ?? 500 })}
              description={t("serviceErrorBody")}
            />
          </div>
        ) : null}
        <dl className="mt-4 grid gap-2 text-sm">
          <Row label={t("fields.requestId")} value={result.request_id} />
          <Row label={t("fields.status")} value={result.status} />
          <Row
            label={t("fields.decision")}
            value={result.decision ?? t("fields.notADecision")}
          />
          <Row label={t("fields.reason")} value={result.reason} />
          <Row
            label={t("fields.latency")}
            value={t("fields.latencyValue", { value: format.number(result.latency_ms) })}
          />
          <Row label={t("fields.mock")} value={String(result.is_mock)} />
        </dl>
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500">{t("fields.labels")}</p>
          {result.risk_labels.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">{t("fields.noLabels")}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {result.risk_labels.map((label) => (
                <li key={label.label}>
                  {label.label} · {format.percent(label.confidence)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <CodeBlock code={prettyJson(request)} label={t("requestJson")} />
      <CodeBlock code={prettyJson(result)} label={t("responseJson")} />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-slate-900">{value}</dd>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
