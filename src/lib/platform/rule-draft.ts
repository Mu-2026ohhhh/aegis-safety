import type { Decision, LabelBinding, RuleConfig, RuleType } from "@/lib/platform/types";

export type RuleDraft = {
  name: string;
  description: string;
  type: RuleType;
  tenantId: string;
  applicationId: string;
  sceneId: string;
  action: Decision;
  priority: number;
  notes: string;
  changeSummary: string;
  labelBindings: LabelBinding[];
  config: RuleConfig;
};
