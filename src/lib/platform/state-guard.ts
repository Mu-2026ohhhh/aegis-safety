import type { PrototypeState } from "@/lib/platform/types";

export function isPrototypeState(value: unknown): value is PrototypeState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PrototypeState>;
  return (
    Array.isArray(record.rules) &&
    Array.isArray(record.ruleVersions) &&
    Array.isArray(record.workflows) &&
    Array.isArray(record.workflowVersions) &&
    Array.isArray(record.capabilities) &&
    Array.isArray(record.evaluations) &&
    Array.isArray(record.executionPlans) &&
    Array.isArray(record.releases) &&
    Array.isArray(record.tasks)
  );
}
