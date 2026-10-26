import type { AuditRecord } from "@/lib/platform/types";

export type FlatRecord = Record<string, string>;

export const auditFieldKeys = [
  "serial",
  "createdAt",
  "content",
  "contentMd5",
  "capabilities",
  "application",
  "channel",
  "scene",
  "ruleIds",
  "decision",
  "status",
  "inputType",
  "riskLabels",
  "latencyMs",
  "id",
] as const;

export const auditGroupFields = [
  { id: "record", fields: ["serial", "createdAt", "id"] },
  { id: "scope", fields: ["application", "channel", "scene"] },
  { id: "detect", fields: ["content", "contentMd5", "capabilities"] },
  { id: "hit", fields: ["decision", "ruleIds", "status", "inputType", "riskLabels", "latencyMs"] },
] as const;

export function presentAudit(
  record: AuditRecord,
  names: { application: string; channel: string; scene: string; capability?: (id: string) => string }
): FlatRecord {
  const capability = names.capability ?? ((id: string) => id);
  return {
    serial: record.requestId,
    createdAt: record.createdAt,
    content: record.content ?? "",
    contentMd5: record.contentMd5 ?? "",
    capabilities: (record.modelCalls ?? []).map((call) => capability(call.capabilityId)).join("|"),
    application: names.application,
    channel: names.channel,
    scene: names.scene,
    ruleIds: record.ruleHits.map((hit) => hit.ruleId).join("|"),
    decision: record.decision ?? "",
    status: record.status,
    inputType: record.inputType,
    riskLabels: record.riskLabels.join("|"),
    latencyMs: String(record.latencyMs),
    id: record.id,
  };
}
