export type Decision = "allow" | "block" | "review";

export type RuleType =
  | "keyword"
  | "ignore_term"
  | "regex"
  | "structured"
  | "model_threshold";

export type VersionStatus =
  | "draft"
  | "pending_evaluation"
  | "evaluating"
  | "evaluation_passed"
  | "pending_release"
  | "published"
  | "rolled_back"
  | "disabled"
  | "archived";

export type KeywordConfig = {
  type: "keyword";
  terms: string[];
  matchMode: "contains" | "exact" | "word";
  exclusions: string[];
  textScope: "all" | "user_text" | "model_output";
};

export type IgnoreTermConfig = {
  type: "ignore_term";
  terms: string[];
  matchMode: "contains" | "exact";
};

export type RegexConfig = {
  type: "regex";
  pattern: string;
  flags: string;
  sampleText: string;
};

export type StructuredConfig = {
  type: "structured";
  field: string;
  operator: "eq" | "neq" | "contains" | "gt" | "lt";
  value: string;
};

export type CompareOperator = "gt" | "lt" | "eq";

export type ThresholdCondition = {
  id: string;
  kind: "constant" | "variable";
  left: string;
  operator: CompareOperator | "contains";
  right: string;
};

export type ModelThresholdConfig = {
  type: "model_threshold";
  capabilityId: string;
  feature: string;
  operator: CompareOperator;
  threshold: number;
  score: number;
  dispose: boolean;
  riskLabel: string;
  riskType: string;
  conditions: ThresholdCondition[];
};

export type RuleConfig =
  | KeywordConfig
  | IgnoreTermConfig
  | RegexConfig
  | StructuredConfig
  | ModelThresholdConfig;

export type RuleVersion = {
  id: string;
  ruleId: string;
  version: number;
  status: VersionStatus;
  name: string;
  description: string;
  type: RuleType;
  tenantId: string;
  applicationId: string;
  sceneId: string;
  action: Decision;
  priority: number;
  notes: string;
  labelBindings: LabelBinding[];
  config: RuleConfig;
  changeSummary: string;
  createdAt: string;
  fingerprint: string;
};

export type Rule = {
  id: string;
  status: VersionStatus;
  currentVersionId: string;
  publishedVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowNodeType =
  | "start"
  | "rule_execution"
  | "model_invocation"
  | "llm"
  | "condition_branch"
  | "result_merge"
  | "end";

export type MergeMode = "block_first" | "priority" | "conflict_review";

export type ConditionField = "rule_hit" | "risk_score" | "label_present";

export type ConditionOperator = "eq" | "neq" | "gt" | "lt";

export type ModelPurpose = "classify" | "score" | "explain";

export type WfNode = {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  label: string;
  /** When true, the UI shows a translated default name instead of `label`. */
  labelIsDefault?: boolean;
  ruleId?: string;
  ruleVersionId?: string;
  capabilityId?: string;
  timeoutMs?: number;
  purpose?: ModelPurpose;
  field?: ConditionField;
  operator?: ConditionOperator;
  value?: string;
  mergeMode?: MergeMode;
  apiMethod?: "GET" | "POST";
  apiPath?: string;
  apiTimeoutMs?: number;
  promptId?: string;
  ragId?: string;
};

export type WfEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: "true" | "false";
};

export type WorkflowVersion = {
  id: string;
  workflowId: string;
  version: number;
  status: VersionStatus;
  name: string;
  description: string;
  nodes: WfNode[];
  edges: WfEdge[];
  changeSummary: string;
  createdAt: string;
  fingerprint: string;
};

export type Workflow = {
  id: string;
  status: VersionStatus;
  currentVersionId: string;
  publishedVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityType = "inhouse_small" | "inhouse_llm" | "keyword_list" | "other";

export type CapabilityVersion = {
  id: string;
  version: string;
  status: "active" | "retired";
};

export type Capability = {
  id: string;
  customName?: string;
  providerId: "aegis";
  type: CapabilityType;
  modalities: Array<"text" | "image">;
  status: "enabled" | "disabled";
  timeoutMs: number;
  versions: CapabilityVersion[];
};

export type DatasetKind = "mirror" | "baseline";

export type DatasetSample = {
  id: string;
  baseline: Decision;
  candidate: Decision | "error";
};

export type Dataset = {
  id: string;
  kind: DatasetKind;
  samples: DatasetSample[];
};

export type ExecutionPlan = {
  id: string;
  targetType: "rule" | "workflow";
  targetId: string;
  targetVersionId: string;
  fingerprint: string;
  ruleVersionIds: string[];
  workflowVersionId?: string;
  capabilityVersionIds: string[];
  decisionPolicy: MergeMode;
  createdAt: string;
  immutable: true;
};

export type EvalCaseStatus = "unchanged" | "changed" | "regressed";

export type EvalCase = {
  sampleId: string;
  baselineDecision: Decision;
  candidateDecision: Decision | "error";
  changed: boolean;
  status: EvalCaseStatus;
};

export type EvaluationRun = {
  id: string;
  targetType: "rule" | "workflow";
  targetId: string;
  targetVersionId: string;
  datasetId: string;
  kind: DatasetKind;
  executionPlanId: string;
  status: "passed" | "failed";
  total: number;
  decisionCounts: Record<Decision | "error", number>;
  changedCount: number;
  cases: EvalCase[];
  createdAt: string;
};

export type ReleaseRecord = {
  id: string;
  targetType: "rule" | "workflow" | "capability";
  targetId: string;
  versionId: string;
  previousVersionId?: string;
  executionPlanId: string;
  action: "publish" | "rollback";
  note: string;
  createdAt: string;
  actor: "prototype-operator";
};

export type AuditRecord = {
  id: string;
  requestId: string;
  applicationId: string;
  channelId: string;
  sceneId: string;
  inputType: "text" | "image";
  decision: Decision | null;
  riskLabels: string[];
  status: "success" | "error";
  latencyMs: number;
  createdAt: string;
  ruleHits: Array<{ ruleId: string; version: number; action: Decision }>;
  modelCalls: Array<{
    capabilityId: string;
    status: "success" | "error" | "skipped";
    latencyMs: number;
  }>;
  workflowId?: string;
  trace: string[];
  errorCode?: number;
};

export type TaskType =
  | "bulk_text_review"
  | "baseline_regression"
  | "image_backfill"
  | "export_audit";

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "partially_failed"
  | "failed"
  | "cancelled";

export type AsyncTask = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  total: number;
  processed: number;
  failed: number;
  createdAt: string;
  failures: Array<{ itemId: string; reasonCode: string }>;
};

export type RuleTemplate = {
  id: string;
  name: string;
  description: string;
  sceneId: string;
  labelIds: string[];
  ruleIds: string[];
  type: RuleType;
  action: Decision;
  config: RuleConfig;
};

export type SamplePolarity = "black" | "white";

export type SampleRecord = {
  id: string;
  input: string;
  expected: Decision | "";
  polarity: SamplePolarity;
  labelIds: string[];
  capabilityIds: string[];
  applicationId: string;
  channelId: string;
  updatedAt: string;
};

export type LabelBinding = {
  labelId: string;
  sceneId: string;
};

export type ContentLabel = {
  id: string;
  name: string;
  parentId: string | null;
  definition: string;
  annotation: string;
  positiveCases: string[];
  negativeCases: string[];
  sceneIds: string[];
};

export type MediaModality = "text" | "image" | "video" | "audio";

export type PlatformVariable = {
  id: string;
  key: string;
  name: string;
  valueType: "number" | "string";
  value: string;
  description: string;
};

export type LibraryEntry = {
  id: string;
  type: RuleType;
  modality: MediaModality;
  sceneId: string;
  labelIds: string[];
  name: string;
  description: string;
  body: string;
  updatedAt: string;
};

export type KnowledgeDoc = {
  id: string;
  parentId: string | null;
  labelIds: string[];
  title: string;
  body: string;
  updatedAt: string;
};

export type PromptRecord = {
  id: string;
  name: string;
  body: string;
  updatedAt: string;
};

export type RagEntry = {
  id: string;
  parentId: string | null;
  knowledgeId: string;
  title: string;
  body: string;
  updatedAt: string;
};

export type SavedQuery = {
  id: string;
  name: string;
  sql: string;
};

export type LlmCase = {
  id: string;
  input: string;
  expected: Decision | "";
};

export type TenantRecord = { id: string; name: string };

export type ApplicationRecord = { id: string; tenantId: string; name: string };

export type ChannelRecord = {
  id: string;
  applicationId: string;
  name: string;
  kind: "text" | "image" | "video" | "audio" | "mixed";
  sceneId: string;
  strategyLabelIds: string[];
};

export type LlmProfile = {
  endpoint: string;
  prompt: string;
  ragNotes: string[];
  updatedAt: string;
};

export type CaseReview = {
  runId: string;
  sampleId: string;
  humanDecision: Decision;
  note: string;
};

export type StoredSample = {
  id: string;
  tenantId: string;
  kind: "text" | "image";
  excerpt: string;
  createdAt: string;
};

export type PrototypeState = {
  rules: Rule[];
  ruleVersions: RuleVersion[];
  workflows: Workflow[];
  workflowVersions: WorkflowVersion[];
  capabilities: Capability[];
  evaluations: EvaluationRun[];
  executionPlans: ExecutionPlan[];
  releases: ReleaseRecord[];
  tasks: AsyncTask[];
  templates: RuleTemplate[];
  labels: ContentLabel[];
  variables: PlatformVariable[];
  libraries: LibraryEntry[];
  knowledge: KnowledgeDoc[];
  prompts: PromptRecord[];
  ragEntries: RagEntry[];
  llmCases: LlmCase[];
  savedQueries: SavedQuery[];
  samples: SampleRecord[];
  tenants: TenantRecord[];
  applications: ApplicationRecord[];
  channels: ChannelRecord[];
  llm: LlmProfile;
  storageByTenant: Record<string, boolean>;
  caseReviews: CaseReview[];
  storedSamples: StoredSample[];
};

export type RiskLabel = {
  label: string;
  confidence: number;
};

export type ModerationResponse = {
  request_id: string;
  status: "success" | "error";
  decision: Decision | null;
  risk_labels: RiskLabel[];
  reason: string;
  latency_ms: number;
  is_mock: true;
  scene_id: string;
  error_code?: number;
  error_message?: string;
};

export type GateCheck = {
  id: "validation" | "mirror" | "baseline" | "confirm";
  ok: boolean;
};

export type ReleaseGate = {
  ok: boolean;
  alreadyLive: boolean;
  checks: GateCheck[];
  versionId: string;
  fingerprint: string;
};
