import { fingerprint } from "@/lib/platform/hash";
import type { RuleDraft } from "@/lib/platform/rule-draft";
import type { RuleConfig } from "@/lib/platform/types";

export function testRegex(
  pattern: string,
  flags: string,
  sample: string
): { ok: true; matches: string[] } | { ok: false; error: "empty" | "too_long" | "invalid"; message?: string } {
  if (!pattern.trim()) return { ok: false, error: "empty" };
  if (pattern.length > 200) return { ok: false, error: "too_long" };
  const safeFlags = flags.replace(/[^gimsuy]/g, "").slice(0, 6);
  try {
    const expression = new RegExp(pattern, safeFlags);
    const matches = sample.match(expression);
    return { ok: true, matches: matches ? [...matches].slice(0, 20) : [] };
  } catch (error) {
    return {
      ok: false,
      error: "invalid",
      message: error instanceof Error ? error.message : "invalid",
    };
  }
}

export function ruleFingerprint(input: {
  type: string;
  action: string;
  priority: number;
  config: RuleConfig;
  sceneId: string;
  applicationId: string;
  labelBindings?: Array<{ labelId: string; sceneId: string }>;
}): string {
  return fingerprint(input);
}

export function validateRuleDraft(draft: RuleDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("name");
  if (!draft.description.trim()) errors.push("description");
  if (!draft.tenantId || !draft.applicationId || !draft.sceneId) errors.push("scope");
  if (!["allow", "block", "review"].includes(draft.action)) errors.push("action");
  if (!Number.isFinite(draft.priority) || draft.priority < 1 || draft.priority > 100) {
    errors.push("priority");
  }
  if (draft.config.type !== draft.type) errors.push("config_type");

  if (draft.config.type === "keyword" || draft.config.type === "ignore_term") {
    if (draft.config.terms.map((term) => term.trim()).filter(Boolean).length === 0) {
      errors.push("terms");
    }
  }
  if (draft.config.type === "regex") {
    const result = testRegex(draft.config.pattern, draft.config.flags, draft.config.sampleText);
    if (!result.ok) errors.push("regex");
  }
  if (draft.config.type === "structured") {
    if (!draft.config.field.trim() || !draft.config.value.trim()) errors.push("structured");
  }
  if (draft.config.type === "model_threshold") {
    if (!draft.config.capabilityId || !draft.config.feature.trim()) errors.push("model");
    if (!["gt", "lt", "eq"].includes(draft.config.operator)) errors.push("operator");
    if (
      !Number.isFinite(draft.config.threshold) ||
      draft.config.threshold < 0 ||
      draft.config.threshold > 1000
    ) {
      errors.push("threshold");
    }
  }
  return errors;
}

export function defaultConfig(type: RuleDraft["type"]): RuleConfig {
  switch (type) {
    case "keyword":
      return {
        type: "keyword",
        terms: [],
        matchMode: "contains",
        exclusions: [],
        textScope: "user_text",
      };
    case "ignore_term":
      return { type: "ignore_term", terms: [], matchMode: "contains" };
    case "regex":
      return { type: "regex", pattern: "", flags: "i", sampleText: "" };
    case "structured":
      return { type: "structured", field: "user.account_age_days", operator: "lt", value: "" };
    case "model_threshold":
      return {
        type: "model_threshold",
        capabilityId: "cap_politics_model",
        feature: "risk_score",
        operator: "gt",
        threshold: 800,
        score: 800,
        dispose: true,
        riskLabel: "example_risk",
        riskType: "model",
        conditions: [],
      };
    default:
      return {
        type: "keyword",
        terms: [],
        matchMode: "contains",
        exclusions: [],
        textScope: "user_text",
      };
  }
}
