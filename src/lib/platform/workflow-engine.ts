import { fingerprint } from "@/lib/platform/hash";
import type {
  Decision,
  MergeMode,
  WfEdge,
  WfNode,
} from "@/lib/platform/types";

export function workflowLogicFingerprint(nodes: WfNode[], edges: WfEdge[]): string {
  return fingerprint({
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ruleId: node.ruleId ?? null,
      ruleVersionId: node.ruleVersionId ?? null,
      capabilityId: node.capabilityId ?? null,
      timeoutMs: node.timeoutMs ?? null,
      purpose: node.purpose ?? null,
      apiMethod: node.apiMethod ?? null,
      apiPath: node.apiPath ?? null,
      apiTimeoutMs: node.apiTimeoutMs ?? null,
      promptId: node.promptId ?? null,
      ragId: node.ragId ?? null,
      field: node.field ?? null,
      operator: node.operator ?? null,
      value: node.value ?? null,
      mergeMode: node.mergeMode ?? null,
    })),
    edges,
  });
}

export type WorkflowIssueCode =
  | "missing_start"
  | "missing_end"
  | "multiple_start"
  | "disconnected"
  | "dangling_edge"
  | "cycle"
  | "condition_incomplete"
  | "condition_outputs"
  | "rule_missing"
  | "model_missing"
  | "timeout_invalid"
  | "merge_missing";

export type WorkflowIssue = {
  code: WorkflowIssueCode;
  nodeId?: string;
  edgeId?: string;
};

export type SimInput = "clean" | "rule_hit" | "model_risk" | "model_timeout";

export type SimStep = {
  nodeId: string;
  nodeType: WfNode["type"];
  label: string;
  status: "success" | "error";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type SimResult = {
  ok: boolean;
  issues: WorkflowIssue[];
  steps: SimStep[];
  finalStatus: "success" | "error";
  decision: Decision | null;
  reason:
    | "completed"
    | "validation_failed"
    | "model_timeout"
    | "dead_end"
    | "cycle";
};

export function validateWorkflow(nodes: WfNode[], edges: WfEdge[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const starts = nodes.filter((node) => node.type === "start");
  const ends = nodes.filter((node) => node.type === "end");
  if (starts.length === 0) issues.push({ code: "missing_start" });
  if (starts.length > 1) starts.forEach((node) => issues.push({ code: "multiple_start", nodeId: node.id }));
  if (ends.length === 0) issues.push({ code: "missing_end" });

  const ids = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({ code: "dangling_edge", edgeId: edge.id });
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      adjacency.get(edge.source)?.push(edge.target);
    }
  }

  if (starts.length === 1) {
    const seen = new Set<string>();
    const stack = [starts[0].id];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const next of adjacency.get(current) ?? []) stack.push(next);
    }
    for (const node of nodes) {
      if (!seen.has(node.id)) issues.push({ code: "disconnected", nodeId: node.id });
    }

    const color = new Map<string, number>();
    let cycleNode: string | undefined;
    const dfs = (nodeId: string): boolean => {
      color.set(nodeId, 1);
      for (const next of adjacency.get(nodeId) ?? []) {
        const state = color.get(next) ?? 0;
        if (state === 1) {
          cycleNode = next;
          return true;
        }
        if (state === 0 && dfs(next)) return true;
      }
      color.set(nodeId, 2);
      return false;
    };
    if (dfs(starts[0].id) && cycleNode) {
      issues.push({ code: "cycle", nodeId: cycleNode });
    }
  }

  for (const node of nodes) {
    if (node.type === "condition_branch") {
      if (!node.field || !node.operator || !node.value?.trim()) {
        issues.push({ code: "condition_incomplete", nodeId: node.id });
      }
      const handles = new Set(
        edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle)
      );
      if (!handles.has("true") || !handles.has("false")) {
        issues.push({ code: "condition_outputs", nodeId: node.id });
      }
    }
    if (node.type === "rule_execution" && !node.ruleId) {
      issues.push({ code: "rule_missing", nodeId: node.id });
    }
    if (node.type === "model_invocation" || node.type === "llm") {
      if (!node.capabilityId) issues.push({ code: "model_missing", nodeId: node.id });
      if (
        node.timeoutMs === undefined ||
        node.timeoutMs < 100 ||
        node.timeoutMs > 30000
      ) {
        issues.push({ code: "timeout_invalid", nodeId: node.id });
      }
    }
    if (node.type === "result_merge" && !node.mergeMode) {
      issues.push({ code: "merge_missing", nodeId: node.id });
    }
  }

  return issues;
}

export function mergeDecisions(mode: MergeMode, decisions: Decision[]): Decision {
  if (decisions.length === 0) return "allow";
  if (mode === "block_first") {
    if (decisions.includes("block")) return "block";
    if (decisions.includes("review")) return "review";
    return "allow";
  }
  if (mode === "conflict_review") {
    const hasBlock = decisions.includes("block");
    const hasAllow = decisions.includes("allow");
    if (hasBlock && hasAllow) return "review";
    if (hasBlock) return "block";
    if (decisions.includes("review")) return "review";
    return "allow";
  }
  return decisions[0];
}

function compare(left: string, operator: WfNode["operator"], value: string): boolean {
  if (operator === "eq") return left === value;
  if (operator === "neq") return left !== value;
  const leftNumber = Number(left);
  const rightNumber = Number(value);
  if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) return false;
  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  return false;
}

export function simulateWorkflow(
  nodes: WfNode[],
  edges: WfEdge[],
  input: SimInput
): SimResult {
  const issues = validateWorkflow(nodes, edges);
  if (issues.length > 0) {
    return {
      ok: false,
      issues,
      steps: [],
      finalStatus: "error",
      decision: null,
      reason: "validation_failed",
    };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = nodes.find((node) => node.type === "start");
  if (!current) {
    return {
      ok: false,
      issues,
      steps: [],
      finalStatus: "error",
      decision: null,
      reason: "validation_failed",
    };
  }

  const steps: SimStep[] = [];
  const visited = new Set<string>();
  let ruleHit = input === "rule_hit";
  const decisions: Decision[] = [];
  const riskScore = input === "model_risk" ? 0.86 : input === "rule_hit" ? 0.8 : 0.12;

  while (current) {
    if (visited.has(current.id)) {
      return {
        ok: false,
        issues: [{ code: "cycle", nodeId: current.id }],
        steps,
        finalStatus: "error",
        decision: null,
        reason: "cycle",
      };
    }
    visited.add(current.id);

    if (current.type === "start") {
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: { sample: input },
        output: { started: true, is_mock: true },
      });
    } else if (current.type === "rule_execution") {
      const action: Decision = "block";
      if (ruleHit) decisions.push(action);
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: { sample: input, ruleId: current.ruleId ?? null, is_mock: true },
        output: { hit: ruleHit, action: ruleHit ? action : null, is_mock: true },
      });
    } else if (current.type === "condition_branch") {
      let left = "false";
      if (current.field === "rule_hit") left = ruleHit ? "true" : "false";
      if (current.field === "risk_score") left = String(riskScore);
      if (current.field === "label_present") {
        left = input === "model_risk" || input === "rule_hit" ? "true" : "false";
      }
      const pass = compare(left, current.operator, current.value ?? "");
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: { field: current.field, left, operator: current.operator, value: current.value },
        output: { branch: pass ? "true" : "false", is_mock: true },
      });
      const edge = edges.find(
        (item) => item.source === current?.id && item.sourceHandle === (pass ? "true" : "false")
      );
      const next = edge ? byId.get(edge.target) : undefined;
      if (!next) {
        return {
          ok: false,
          issues: [],
          steps,
          finalStatus: "error",
          decision: null,
          reason: "dead_end",
        };
      }
      current = next;
      continue;
    } else if (current.type === "model_invocation" || current.type === "llm") {
      if (input === "model_timeout") {
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          label: current.label,
          status: "error",
          input: { capabilityId: current.capabilityId ?? null, timeoutMs: current.timeoutMs },
          output: { error_code: 503, is_mock: true },
        });
        return {
          ok: false,
          issues: [],
          steps,
          finalStatus: "error",
          decision: null,
          reason: "model_timeout",
        };
      }
      const decision: Decision = input === "model_risk" ? "review" : "allow";
      decisions.push(decision);
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: {
          capabilityId: current.capabilityId ?? null,
          purpose: current.purpose ?? "classify",
          is_mock: true,
        },
        output: {
          decision,
          is_mock: true,
          sent_externally: false,
          promptId: current.promptId ?? null,
          ragId: current.ragId ?? null,
        },
      });
    } else if (current.type === "result_merge") {
      const mode = current.mergeMode ?? "block_first";
      const candidates = [...decisions];
      const decision = mergeDecisions(mode, candidates);
      decisions.splice(0, decisions.length, decision);
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: { mode, candidates },
        output: { decision, is_mock: true },
      });
    } else if (current.type === "end") {
      const decision = decisions[0] ?? "allow";
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: "success",
        input: { decision },
        output: { decision, is_mock: true },
      });
      return {
        ok: true,
        issues: [],
        steps,
        finalStatus: "success",
        decision,
        reason: "completed",
      };
    }

    const edge = edges.find(
      (item) => item.source === current?.id && item.sourceHandle == null
    );
    const next = edge ? byId.get(edge.target) : undefined;
    if (!next) {
      return {
        ok: false,
        issues: [],
        steps,
        finalStatus: "error",
        decision: null,
        reason: "dead_end",
      };
    }
    current = next;
  }

  return {
    ok: false,
    issues: [],
    steps,
    finalStatus: "error",
    decision: null,
    reason: "dead_end",
  };
}
