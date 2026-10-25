import type { RuleDraft } from "@/lib/platform/rule-draft";
import { validateRuleDraft } from "@/lib/platform/rules";
import type {
  Dataset,
  EvalCase,
  EvaluationRun,
  ExecutionPlan,
  Capability,
  PrototypeState,
  ReleaseGate,
  RuleVersion,
  WorkflowVersion,
} from "@/lib/platform/types";
import { validateWorkflow } from "@/lib/platform/workflow-engine";

export function draftFromRuleVersion(version: RuleVersion): RuleDraft {
  return {
    name: version.name,
    description: version.description,
    type: version.type,
    tenantId: version.tenantId,
    applicationId: version.applicationId,
    sceneId: version.sceneId,
    action: version.action,
    priority: version.priority,
    notes: version.notes,
    changeSummary: version.changeSummary,
    labelBindings: version.labelBindings ?? [],
    config: version.config,
  };
}

export function ruleVersionIsValid(version: RuleVersion): boolean {
  return validateRuleDraft(draftFromRuleVersion(version)).length === 0;
}

export function workflowVersionIsValid(version: WorkflowVersion): boolean {
  return validateWorkflow(version.nodes, version.edges).length === 0;
}

export function activeCapabilityVersionId(
  state: { capabilities: Capability[] },
  capabilityId: string | undefined
): string | undefined {
  if (!capabilityId) return undefined;
  const capability = state.capabilities.find((item) => item.id === capabilityId);
  return capability?.versions.find((version) => version.status === "active")?.id;
}

export function planFromRule(
  state: { capabilities: Capability[] },
  version: RuleVersion,
  id: string,
  createdAt: string
): ExecutionPlan {
  const capabilityId =
    version.config.type === "model_threshold" ? version.config.capabilityId : undefined;
  const capabilityVersionId = activeCapabilityVersionId(state, capabilityId);
  return {
    id,
    targetType: "rule",
    targetId: version.ruleId,
    targetVersionId: version.id,
    fingerprint: version.fingerprint,
    ruleVersionIds: [version.id],
    capabilityVersionIds: capabilityVersionId ? [capabilityVersionId] : [],
    decisionPolicy: "block_first",
    createdAt,
    immutable: true,
  };
}

export function planFromWorkflow(
  state: { capabilities: Capability[] },
  version: WorkflowVersion,
  id: string,
  createdAt: string
): ExecutionPlan {
  const ruleVersionIds = [
    ...new Set(
      version.nodes
        .map((node) => node.ruleVersionId)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const capabilityVersionIds = [
    ...new Set(
      version.nodes
        .map((node) => activeCapabilityVersionId(state, node.capabilityId))
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const merge = version.nodes.find((node) => node.type === "result_merge");
  return {
    id,
    targetType: "workflow",
    targetId: version.workflowId,
    targetVersionId: version.id,
    fingerprint: version.fingerprint,
    ruleVersionIds,
    workflowVersionId: version.id,
    capabilityVersionIds,
    decisionPolicy: merge?.mergeMode ?? "block_first",
    createdAt,
    immutable: true,
  };
}

export function casesForDataset(dataset: Dataset): EvalCase[] {
  return dataset.samples.map((sample) => {
    const changed = sample.candidate !== sample.baseline;
    const status =
      dataset.kind === "baseline" && changed
        ? "regressed"
        : changed
          ? "changed"
          : "unchanged";
    return {
      sampleId: sample.id,
      baselineDecision: sample.baseline,
      candidateDecision: sample.candidate,
      changed,
      status,
    };
  });
}

export function summarizeCases(cases: EvalCase[]): EvaluationRun["decisionCounts"] {
  const counts: EvaluationRun["decisionCounts"] = {
    allow: 0,
    block: 0,
    review: 0,
    error: 0,
  };
  for (const item of cases) {
    counts[item.candidateDecision] += 1;
  }
  return counts;
}

export function latestRun(
  state: PrototypeState,
  versionId: string,
  fingerprint: string,
  kind: "mirror" | "baseline"
): EvaluationRun | undefined {
  const matches = state.evaluations.filter((run) => {
    if (run.targetVersionId !== versionId || run.kind !== kind) return false;
    const plan = state.executionPlans.find((item) => item.id === run.executionPlanId);
    return plan?.fingerprint === fingerprint;
  });
  return matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

export function releaseGate(
  state: PrototypeState,
  targetType: "rule" | "workflow",
  targetId: string
): ReleaseGate | null {
  if (targetType === "rule") {
    const rule = state.rules.find((item) => item.id === targetId);
    const version = state.ruleVersions.find((item) => item.id === rule?.currentVersionId);
    if (!rule || !version) return null;
    const mirror = latestRun(state, version.id, version.fingerprint, "mirror");
    const baseline = latestRun(state, version.id, version.fingerprint, "baseline");
    const checks = [
      { id: "validation" as const, ok: ruleVersionIsValid(version) },
      { id: "mirror" as const, ok: mirror?.status === "passed" },
      { id: "baseline" as const, ok: baseline?.status === "passed" },
    ];
    const alreadyLive = rule.publishedVersionId === version.id && rule.status === "published";
    return {
      ok: checks.every((check) => check.ok) && !alreadyLive && rule.status !== "archived",
      alreadyLive,
      checks,
      versionId: version.id,
      fingerprint: version.fingerprint,
    };
  }

  const workflow = state.workflows.find((item) => item.id === targetId);
  const version = state.workflowVersions.find(
    (item) => item.id === workflow?.currentVersionId
  );
  if (!workflow || !version) return null;
  const mirror = latestRun(state, version.id, version.fingerprint, "mirror");
  const baseline = latestRun(state, version.id, version.fingerprint, "baseline");
  const checks = [
    { id: "validation" as const, ok: workflowVersionIsValid(version) },
    { id: "mirror" as const, ok: mirror?.status === "passed" },
    { id: "baseline" as const, ok: baseline?.status === "passed" },
  ];
  const alreadyLive =
    workflow.publishedVersionId === version.id && workflow.status === "published";
  return {
    ok: checks.every((check) => check.ok) && !alreadyLive,
    alreadyLive,
    checks,
    versionId: version.id,
    fingerprint: version.fingerprint,
  };
}

export function statusAfterEvaluation(
  current: RuleVersion["status"],
  mirrorPassed: boolean,
  baselinePassed: boolean
): RuleVersion["status"] {
  if (
    current === "published" ||
    current === "disabled" ||
    current === "archived" ||
    current === "rolled_back"
  ) {
    return current;
  }
  if (mirrorPassed && baselinePassed) return "pending_release";
  if (mirrorPassed) return "evaluation_passed";
  return "draft";
}
