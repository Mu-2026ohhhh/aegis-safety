import type { AuditRecord } from "@/lib/platform/types";

export type FlatRecord = Record<string, string>;

export const auditFieldKeys = [
  "serial",
  "createdAt",
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

export function presentAudit(
  record: AuditRecord,
  names: { application: string; channel: string; scene: string }
): FlatRecord {
  return {
    serial: record.requestId,
    createdAt: record.createdAt,
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
