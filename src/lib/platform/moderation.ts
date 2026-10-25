import type { Decision, ModerationResponse, RiskLabel } from "@/lib/platform/types";

export type TextSampleId = "safe" | "risk" | "review" | "outage";
export type ImageSampleId = "safe" | "risk" | "review" | "outage";

const TEXT_SAMPLES: Record<
  TextSampleId,
  { decision: Decision | null; labels: RiskLabel[]; latency: number; error?: number }
> = {
  safe: { decision: "allow", labels: [], latency: 120 },
  risk: {
    decision: "block",
    labels: [{ label: "example_risk", confidence: 0.93 }],
    latency: 160,
  },
  review: {
    decision: "review",
    labels: [{ label: "example_risk", confidence: 0.91 }],
    latency: 180,
  },
  outage: { decision: null, labels: [], latency: 40, error: 503 },
};

const IMAGE_SAMPLES: Record<
  ImageSampleId,
  { decision: Decision | null; labels: RiskLabel[]; latency: number; error?: number }
> = {
  safe: { decision: "allow", labels: [], latency: 210 },
  risk: {
    decision: "block",
    labels: [{ label: "example_image_risk", confidence: 0.88 }],
    latency: 260,
  },
  review: {
    decision: "review",
    labels: [{ label: "example_image_risk", confidence: 0.67 }],
    latency: 240,
  },
  outage: { decision: null, labels: [], latency: 50, error: 503 },
};

let requestCounter = 1;

function nextRequestId() {
  const id = `req_demo_${String(requestCounter).padStart(3, "0")}`;
  requestCounter += 1;
  return id;
}

export function buildTextResponse(input: {
  sample: TextSampleId | null;
  text: string;
  sceneId: string;
  reason: string;
  errorMessage?: string;
}): ModerationResponse {
  const sample = input.sample ? TEXT_SAMPLES[input.sample] : inferText(input.text);
  return finish(sample, input.sceneId, input.reason, input.errorMessage);
}

export function buildImageResponse(input: {
  sample: ImageSampleId | null;
  sceneId: string;
  reason: string;
  errorMessage?: string;
  errorCode?: number;
}): ModerationResponse {
  if (input.errorCode) {
    return {
      request_id: nextRequestId(),
      status: "error",
      decision: null,
      risk_labels: [],
      reason: input.reason,
      latency_ms: 15,
      is_mock: true,
      scene_id: input.sceneId,
      error_code: input.errorCode,
      error_message: input.errorMessage ?? input.reason,
    };
  }
  const sample = input.sample ? IMAGE_SAMPLES[input.sample] : IMAGE_SAMPLES.safe;
  return finish(sample, input.sceneId, input.reason, input.errorMessage);
}

export function buildQuotaResponse(input: {
  sceneId: string;
  reason: string;
  errorMessage: string;
}): ModerationResponse {
  return {
    request_id: nextRequestId(),
    status: "error",
    decision: null,
    risk_labels: [],
    reason: input.reason,
    latency_ms: 5,
    is_mock: true,
    scene_id: input.sceneId,
    error_code: 429,
    error_message: input.errorMessage,
  };
}

export function buildInvalidResponse(input: {
  sceneId: string;
  reason: string;
  errorMessage: string;
  errorCode: 400 | 413;
}): ModerationResponse {
  return {
    request_id: nextRequestId(),
    status: "error",
    decision: null,
    risk_labels: [],
    reason: input.reason,
    latency_ms: 8,
    is_mock: true,
    scene_id: input.sceneId,
    error_code: input.errorCode,
    error_message: input.errorMessage,
  };
}

function finish(
  sample: {
    decision: Decision | null;
    labels: RiskLabel[];
    latency: number;
    error?: number;
  },
  sceneId: string,
  reason: string,
  errorMessage?: string
): ModerationResponse {
  if (sample.error || sample.decision === null) {
    return {
      request_id: nextRequestId(),
      status: "error",
      decision: null,
      risk_labels: [],
      reason,
      latency_ms: sample.latency,
      is_mock: true,
      scene_id: sceneId,
      error_code: sample.error ?? 500,
      error_message: errorMessage ?? reason,
    };
  }
  return {
    request_id: nextRequestId(),
    status: "success",
    decision: sample.decision,
    risk_labels: sample.labels,
    reason,
    latency_ms: sample.latency,
    is_mock: true,
    scene_id: sceneId,
  };
}

function inferText(text: string): {
  decision: Decision | null;
  labels: RiskLabel[];
  latency: number;
  error?: number;
} {
  const value = text.toLowerCase();
  if (value.includes("demo_outage")) return TEXT_SAMPLES.outage;
  if (value.includes("demo_review_token")) return TEXT_SAMPLES.review;
  if (value.includes("demo_block_token")) return TEXT_SAMPLES.risk;
  return TEXT_SAMPLES.safe;
}

export const contractExamples = {
  textRequest: {
    text: "Example user-generated content",
    scene_id: "default",
    metadata: { source: "playground" },
  },
  textResponse: {
    request_id: "req_demo_001",
    status: "success",
    decision: "review",
    risk_labels: [{ label: "example_risk", confidence: 0.91 }],
    reason: "Demo sample flagged for human review.",
    latency_ms: 180,
    is_mock: true,
    scene_id: "default",
  } satisfies ModerationResponse,
  imageRequest: {
    image_url: "https://example.com/demo-image.png",
    scene_id: "default",
    metadata: { source: "docs" },
  },
  imageResponse: {
    request_id: "req_demo_img_001",
    status: "success",
    decision: "block",
    risk_labels: [{ label: "example_image_risk", confidence: 0.88 }],
    reason: "Demo image sample matched a block policy.",
    latency_ms: 260,
    is_mock: true,
    scene_id: "default",
  } satisfies ModerationResponse,
  errorResponse: {
    request_id: "req_demo_err_001",
    status: "error",
    decision: null,
    risk_labels: [],
    reason: "Moderation service temporarily unavailable.",
    latency_ms: 40,
    is_mock: true,
    scene_id: "default",
    error_code: 503,
    error_message: "Moderation service temporarily unavailable.",
  } satisfies ModerationResponse,
};

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
