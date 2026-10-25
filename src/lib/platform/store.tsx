"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  casesForDataset,
  planFromRule,
  planFromWorkflow,
  releaseGate,
  statusAfterEvaluation,
  summarizeCases,
} from "@/lib/platform/governance";
import { createId } from "@/lib/platform/hash";
import type { RuleDraft } from "@/lib/platform/rule-draft";
import { ruleFingerprint, validateRuleDraft } from "@/lib/platform/rules";
import { datasets, createSeedState } from "@/lib/platform/seed";
import type {
  Capability,
  CapabilityType,
  CaseReview,
  ChannelRecord,
  ContentLabel,
  SavedQuery,
  KnowledgeDoc,
  LibraryEntry,
  LlmCase,
  LlmProfile,
  ModelThresholdConfig,
  PlatformVariable,
  PromptRecord,
  PrototypeState,
  RagEntry,
  ReleaseGate,
  RuleConfig,
  RuleTemplate,
  SampleRecord,
  RuleVersion,
  StoredSample,
  VersionStatus,
  WorkflowVersion,
} from "@/lib/platform/types";
import {
  validateWorkflow,
  workflowLogicFingerprint,
} from "@/lib/platform/workflow-engine";

const STORAGE_KEY = "aegis_prototype_state_v1";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type WorkflowDraft = {
  name: string;
  description: string;
  nodes: WorkflowVersion["nodes"];
  edges: WorkflowVersion["edges"];
  changeSummary: string;
};

type StoreValue = {
  ready: boolean;
  state: PrototypeState;
  reset: () => void;
  createRule: (draft: RuleDraft) => Result<{ id: string }>;
  updateRule: (ruleId: string, draft: RuleDraft) => Result<{ id: string; forked: boolean }>;
  copyRule: (ruleId: string, name: string) => Result<{ id: string }>;
  setRuleLifecycle: (
    ruleId: string,
    action: "disable" | "archive" | "restore" | "submit"
  ) => Result<{ id: string }>;
  createWorkflow: (name: string, description: string) => Result<{ id: string }>;
  saveWorkflow: (
    workflowId: string,
    draft: WorkflowDraft
  ) => Result<{ id: string; forked: boolean }>;
  copyWorkflow: (workflowId: string, name: string) => Result<{ id: string }>;
  updateCapability: (
    capabilityId: string,
    patch: { customName?: string; timeoutMs: number; status: Capability["status"] }
  ) => Result<{ id: string }>;
  startEvaluation: (input: {
    targetType: "rule" | "workflow";
    targetId: string;
    datasetId: string;
  }) => Result<{ id: string }>;
  publish: (input: {
    targetType: "rule" | "workflow";
    targetId: string;
    note: string;
  }) => Result<{ id: string }>;
  rollback: (input: {
    targetType: "rule" | "workflow";
    targetId: string;
    note: string;
  }) => Result<{ id: string }>;
  retryTask: (taskId: string) => Result<{ id: string }>;
  cancelTask: (taskId: string) => Result<{ id: string }>;
  gateFor: (targetType: "rule" | "workflow", targetId: string) => ReleaseGate | null;
  saveTemplate: (template: RuleTemplate) => Result<{ id: string }>;
  applyTemplate: (templateId: string, channelId: string) => Result<{ count: number }>;
  saveSample: (sample: SampleRecord) => Result<{ id: string }>;
  deleteSample: (id: string) => void;
  importSamples: (samples: SampleRecord[]) => void;
  saveLabel: (label: ContentLabel) => Result<{ id: string }>;
  deleteLabel: (id: string) => Result<{ id: string }>;
  saveVariable: (variable: PlatformVariable) => Result<{ id: string }>;
  deleteVariable: (id: string) => void;
  saveLibrary: (entry: LibraryEntry) => Result<{ id: string }>;
  deleteLibrary: (id: string) => void;
  importLibraries: (entries: LibraryEntry[]) => void;
  saveKnowledge: (doc: KnowledgeDoc) => Result<{ id: string }>;
  deleteKnowledge: (id: string) => void;
  savePrompt: (prompt: PromptRecord) => Result<{ id: string }>;
  deletePrompt: (id: string) => void;
  saveRag: (entry: RagEntry) => Result<{ id: string }>;
  deleteRag: (id: string) => void;
  setLlmCases: (cases: LlmCase[]) => void;
  saveLlm: (profile: LlmProfile) => void;
  setStorage: (tenantId: string, enabled: boolean) => void;
  addApplication: (tenantId: string, name: string) => Result<{ id: string }>;
  addChannel: (applicationId: string, name: string, kind: ChannelRecord["kind"]) => Result<{ id: string }>;
  setChannelStrategy: (channelId: string, sceneId: string, strategyLabelIds: string[]) => void;
  batchRules: (ids: string[], action: "enable" | "disable" | "close" | "delete") => Result<{ count: number }>;
  importLabels: (labels: ContentLabel[]) => void;
  saveQuery: (query: SavedQuery) => Result<{ id: string }>;
  deleteQuery: (id: string) => void;
  saveCaseReview: (review: CaseReview) => void;
  rememberSample: (sample: StoredSample) => void;
  rollbackCapability: (capabilityId: string) => Result<{ id: string }>;
};

const StoreContext = createContext<StoreValue | null>(null);

function isState(value: unknown): value is PrototypeState {
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

function fillModelConfig(config: RuleConfig): RuleConfig {
  if (config.type !== "model_threshold") return config;
  const current = config as ModelThresholdConfig;
  const threshold = Number.isFinite(current.threshold) ? current.threshold : 800;
  return {
    ...current,
    operator: current.operator ?? "gt",
    score: Number.isFinite(current.score)
      ? current.score
      : threshold <= 1
        ? Math.round(threshold * 1000)
        : threshold,
    dispose: current.dispose ?? true,
    riskLabel: current.riskLabel ?? "",
    riskType: current.riskType ?? "",
    conditions: Array.isArray(current.conditions) ? current.conditions : [],
  };
}

function mergeCapabilities(current: Capability[] | undefined, seed: Capability[]): Capability[] {
  const list = (current ?? [])
    .filter((item) => item.id !== "cap_vendor_api")
    .map((item) => ({
      ...item,
      providerId: "aegis" as const,
      type: (item.type === ("third_party" as CapabilityType) ? "inhouse_small" : item.type) as CapabilityType,
    }));
  const ids = new Set(list.map((item) => item.id));
  return [...list, ...seed.filter((item) => !ids.has(item.id))];
}

function mergeById<T extends { id: string }>(current: T[] | undefined, seed: T[]): T[] {
  const list = current ?? [];
  const ids = new Set(list.map((item) => item.id));
  return [...list, ...seed.filter((item) => !ids.has(item.id))];
}

function mergeLabels(current: ContentLabel[] | undefined, seed: ContentLabel[]): ContentLabel[] {
  const normalized = (current ?? []).map((label) => {
    const match = seed.find((item) => item.id === label.id);
    return {
      ...label,
      parentId: label.parentId ?? match?.parentId ?? null,
      sceneIds: Array.isArray(label.sceneIds) && label.sceneIds.length ? label.sceneIds : (match?.sceneIds ?? []),
      annotation: label.annotation ?? match?.annotation ?? "",
      positiveCases: label.positiveCases ?? [],
      negativeCases: label.negativeCases ?? [],
    };
  });
  const ids = new Set(normalized.map((item) => item.id));
  return [...normalized, ...seed.filter((item) => !ids.has(item.id))];
}

function hydrateState(value: PrototypeState): PrototypeState {
  const seed = createSeedState();
  return {
    ...seed,
    ...value,
    capabilities: mergeCapabilities(value.capabilities, seed.capabilities),
    ruleVersions: value.ruleVersions.map((version) => ({
      ...version,
      labelBindings: Array.isArray(version.labelBindings) ? version.labelBindings : [],
      config: fillModelConfig(version.config),
    })),
    templates: mergeById(value.templates, seed.templates).map((item) => {
      const match = seed.templates.find((entry) => entry.id === item.id);
      return {
        ...item,
        sceneId: item.sceneId || match?.sceneId || "scene_ugc",
        labelIds: item.labelIds?.length ? item.labelIds : match?.labelIds ?? [],
        ruleIds: item.ruleIds?.length ? item.ruleIds : match?.ruleIds ?? [],
        config: item.config ?? match?.config,
      };
    }),
    samples: mergeById(value.samples, seed.samples).map((item) => ({
      ...item,
      labelIds: item.labelIds ?? [],
      capabilityIds: item.capabilityIds ?? [],
      polarity: item.polarity === "white" ? "white" : "black",
      expected: item.expected ?? "",
    })),
    labels: mergeLabels(value.labels, seed.labels),
    variables: value.variables?.length ? value.variables : seed.variables,
    libraries: mergeById(value.libraries, seed.libraries).map((item) => {
      const match = seed.libraries.find((entry) => entry.id === item.id);
      const untouched = Boolean(match && item.updatedAt === match.updatedAt);
      return {
        ...item,
        modality: (untouched ? match?.modality : item.modality) ?? match?.modality ?? "text",
        sceneId: (untouched ? match?.sceneId : item.sceneId) || match?.sceneId || "scene_ugc",
        labelIds: item.labelIds?.length ? item.labelIds : (untouched ? match?.labelIds ?? [] : item.labelIds ?? []),
      };
    }),
    knowledge: mergeById(value.knowledge, seed.knowledge).map((item) => {
      const match = seed.knowledge.find((entry) => entry.id === item.id);
      const untouched = Boolean(match && item.updatedAt === match.updatedAt);
      return {
        ...item,
        parentId: item.parentId ?? null,
        labelIds: item.labelIds?.length ? item.labelIds : untouched ? match?.labelIds ?? [] : item.labelIds ?? [],
      };
    }),
    prompts: value.prompts?.length ? value.prompts : seed.prompts,
    ragEntries: mergeById(value.ragEntries, seed.ragEntries).map((item) => ({
      ...item,
      parentId: item.parentId ?? null,
    })),
    llmCases: value.llmCases?.length ? value.llmCases : seed.llmCases,
    savedQueries: value.savedQueries?.length ? value.savedQueries : seed.savedQueries,
    channels: (value.channels?.length ? value.channels : seed.channels).map((item) => {
      const match = seed.channels.find((entry) => entry.id === item.id);
      return {
        ...item,
        sceneId: item.sceneId || match?.sceneId || "scene_ugc",
        strategyLabelIds: Array.isArray(item.strategyLabelIds) ? item.strategyLabelIds : (match?.strategyLabelIds ?? []),
      };
    }),
    tenants: value.tenants?.length ? value.tenants : seed.tenants,
    applications: value.applications?.length ? value.applications : seed.applications,
    llm: value.llm?.prompt ? value.llm : seed.llm,
    storageByTenant: { ...seed.storageByTenant, ...(value.storageByTenant ?? {}) },
    caseReviews: value.caseReviews ?? [],
    storedSamples: value.storedSamples ?? [],
  };
}

function versionFromDraft(
  draft: RuleDraft,
  ids: { id: string; ruleId: string; version: number; createdAt: string }
): RuleVersion {
  return {
    ...ids,
    status: "draft",
    name: draft.name.trim(),
    description: draft.description.trim(),
    type: draft.type,
    tenantId: draft.tenantId,
    applicationId: draft.applicationId,
    sceneId: draft.sceneId,
    action: draft.action,
    priority: draft.priority,
    notes: draft.notes.trim(),
    labelBindings: draft.labelBindings ?? [],
    config: draft.config,
    changeSummary: draft.changeSummary.trim() || "Updated candidate.",
    fingerprint: ruleFingerprint({
      type: draft.type,
      action: draft.action,
      priority: draft.priority,
      config: draft.config,
      sceneId: draft.sceneId,
      applicationId: draft.applicationId,
      labelBindings: draft.labelBindings ?? [],
    }),
  };
}

export function PrototypeStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PrototypeState>(() => createSeedState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isState(parsed)) setState(hydrateState(parsed));
      }
    } catch {
      // Ignore corrupt prototype storage and keep the seed.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const api = useMemo<StoreValue>(() => {
    return {
      ready,
      state,
      reset: () => {
        const next = createSeedState();
        setState(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      },
      createRule: (draft) => {
        const errors = validateRuleDraft(draft);
        if (errors.length > 0) return { ok: false, error: errors[0] };
        const now = new Date().toISOString();
        const id = createId("rule");
        const version = versionFromDraft(draft, {
          id: createId("rv"),
          ruleId: id,
          version: 1,
          createdAt: now,
        });
        setState((current) => ({
          ...current,
          rules: [
            ...current.rules,
            {
              id,
              status: "draft",
              currentVersionId: version.id,
              createdAt: now,
              updatedAt: now,
            },
          ],
          ruleVersions: [...current.ruleVersions, version],
        }));
        return { ok: true, data: { id } };
      },
      updateRule: (ruleId, draft) => {
        const errors = validateRuleDraft(draft);
        if (errors.length > 0) return { ok: false, error: errors[0] };
        let forked = false;
        let failed: string | null = null;
        setState((current) => {
          const rule = current.rules.find((item) => item.id === ruleId);
          const existing = current.ruleVersions.find(
            (item) => item.id === rule?.currentVersionId
          );
          if (!rule || !existing) {
            failed = "missing";
            return current;
          }
          if (rule.status === "archived") {
            failed = "archived";
            return current;
          }
          const now = new Date().toISOString();
          const live = rule.publishedVersionId === existing.id;
          if (live) {
            forked = true;
            const version = versionFromDraft(draft, {
              id: createId("rv"),
              ruleId,
              version: existing.version + 1,
              createdAt: now,
            });
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === ruleId
                  ? { ...item, status: "draft", currentVersionId: version.id, updatedAt: now }
                  : item
              ),
              ruleVersions: [...current.ruleVersions, version],
            };
          }
          const version = versionFromDraft(draft, {
            id: existing.id,
            ruleId,
            version: existing.version,
            createdAt: existing.createdAt,
          });
          return {
            ...current,
            rules: current.rules.map((item) =>
              item.id === ruleId ? { ...item, status: "draft", updatedAt: now } : item
            ),
            ruleVersions: current.ruleVersions.map((item) =>
              item.id === existing.id ? version : item
            ),
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: ruleId, forked } };
      },
      copyRule: (ruleId, name) => {
        let created: string | null = null;
        let failed: string | null = null;
        setState((current) => {
          const rule = current.rules.find((item) => item.id === ruleId);
          const existing = current.ruleVersions.find(
            (item) => item.id === rule?.currentVersionId
          );
          if (!rule || !existing) {
            failed = "missing";
            return current;
          }
          const now = new Date().toISOString();
          const id = createId("rule");
          created = id;
          const version = versionFromDraft(
            {
              name,
              description: existing.description,
              type: existing.type,
              tenantId: existing.tenantId,
              applicationId: existing.applicationId,
              sceneId: existing.sceneId,
              action: existing.action,
              priority: existing.priority,
              notes: existing.notes,
              changeSummary: "Copied from an existing rule.",
              labelBindings: existing.labelBindings ?? [],
              config: existing.config,
            },
            { id: createId("rv"), ruleId: id, version: 1, createdAt: now }
          );
          return {
            ...current,
            rules: [
              ...current.rules,
              {
                id,
                status: "draft",
                currentVersionId: version.id,
                createdAt: now,
                updatedAt: now,
              },
            ],
            ruleVersions: [...current.ruleVersions, version],
          };
        });
        if (failed || !created) return { ok: false, error: failed ?? "missing" };
        return { ok: true, data: { id: created } };
      },
      setRuleLifecycle: (ruleId, action) => {
        let failed: string | null = null;
        setState((current) => {
          const rule = current.rules.find((item) => item.id === ruleId);
          const version = current.ruleVersions.find(
            (item) => item.id === rule?.currentVersionId
          );
          if (!rule || !version) {
            failed = "missing";
            return current;
          }
          if (action === "submit") {
            if (rule.status !== "draft") {
              failed = "not_draft";
              return current;
            }
            const now = new Date().toISOString();
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === ruleId ? { ...item, status: "pending_evaluation", updatedAt: now } : item
              ),
              ruleVersions: current.ruleVersions.map((item) =>
                item.id === version.id ? { ...item, status: "pending_evaluation" } : item
              ),
            };
          }
          if (action === "archive") {
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === ruleId
                  ? { ...item, status: "archived", updatedAt: new Date().toISOString() }
                  : item
              ),
            };
          }
          if (action === "disable") {
            if (rule.status === "archived") {
              failed = "archived";
              return current;
            }
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === ruleId
                  ? { ...item, status: "disabled", updatedAt: new Date().toISOString() }
                  : item
              ),
            };
          }
          if (rule.status !== "disabled") {
            failed = "not_disabled";
            return current;
          }
          return {
            ...current,
            rules: current.rules.map((item) =>
              item.id === ruleId
                ? { ...item, status: version.status, updatedAt: new Date().toISOString() }
                : item
            ),
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: ruleId } };
      },
      createWorkflow: (name, description) => {
        if (!name.trim()) return { ok: false, error: "name" };
        const now = new Date().toISOString();
        const id = createId("wf");
        const startId = createId("node");
        const endId = createId("node");
        const nodes: WorkflowVersion["nodes"] = [
          {
            id: startId,
            type: "start",
            position: { x: 80, y: 160 },
            label: "Start",
            labelIsDefault: true,
          },
          {
            id: endId,
            type: "end",
            position: { x: 420, y: 160 },
            label: "End",
            labelIsDefault: true,
          },
        ];
        const edges = [{ id: createId("edge"), source: startId, target: endId }];
        const version: WorkflowVersion = {
          id: createId("wv"),
          workflowId: id,
          version: 1,
          status: "draft",
          name: name.trim(),
          description: description.trim(),
          nodes,
          edges,
          changeSummary: "Created workflow.",
          createdAt: now,
          fingerprint: workflowLogicFingerprint(nodes, edges),
        };
        setState((current) => ({
          ...current,
          workflows: [
            ...current.workflows,
            {
              id,
              status: "draft",
              currentVersionId: version.id,
              createdAt: now,
              updatedAt: now,
            },
          ],
          workflowVersions: [...current.workflowVersions, version],
        }));
        return { ok: true, data: { id } };
      },
      saveWorkflow: (workflowId, draft) => {
        if (!draft.name.trim()) return { ok: false, error: "name" };
        let forked = false;
        let failed: string | null = null;
        setState((current) => {
          const workflow = current.workflows.find((item) => item.id === workflowId);
          const existing = current.workflowVersions.find(
            (item) => item.id === workflow?.currentVersionId
          );
          if (!workflow || !existing) {
            failed = "missing";
            return current;
          }
          const now = new Date().toISOString();
          const fingerprint = workflowLogicFingerprint(draft.nodes, draft.edges);
          const live = workflow.publishedVersionId === existing.id;
          if (live) {
            forked = true;
            const version: WorkflowVersion = {
              ...existing,
              id: createId("wv"),
              version: existing.version + 1,
              status: "draft",
              name: draft.name.trim(),
              description: draft.description.trim(),
              nodes: draft.nodes,
              edges: draft.edges,
              changeSummary: draft.changeSummary.trim() || "Forked from the published version.",
              createdAt: now,
              fingerprint,
            };
            return {
              ...current,
              workflows: current.workflows.map((item) =>
                item.id === workflowId
                  ? { ...item, status: "draft", currentVersionId: version.id, updatedAt: now }
                  : item
              ),
              workflowVersions: [...current.workflowVersions, version],
            };
          }
          const changed = fingerprint !== existing.fingerprint;
          const status: VersionStatus = changed ? "draft" : existing.status;
          const version: WorkflowVersion = {
            ...existing,
            status,
            name: draft.name.trim(),
            description: draft.description.trim(),
            nodes: draft.nodes,
            edges: draft.edges,
            changeSummary: draft.changeSummary.trim() || existing.changeSummary,
            fingerprint,
          };
          return {
            ...current,
            workflows: current.workflows.map((item) =>
              item.id === workflowId
                ? { ...item, status: changed ? "draft" : item.status, updatedAt: now }
                : item
            ),
            workflowVersions: current.workflowVersions.map((item) =>
              item.id === existing.id ? version : item
            ),
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: workflowId, forked } };
      },
      copyWorkflow: (workflowId, name) => {
        let created: string | null = null;
        setState((current) => {
          const workflow = current.workflows.find((item) => item.id === workflowId);
          const existing = current.workflowVersions.find(
            (item) => item.id === workflow?.currentVersionId
          );
          if (!workflow || !existing) return current;
          const now = new Date().toISOString();
          const id = createId("wf");
          created = id;
          const version: WorkflowVersion = {
            ...existing,
            id: createId("wv"),
            workflowId: id,
            version: 1,
            status: "draft",
            name,
            changeSummary: "Copied workflow.",
            createdAt: now,
            fingerprint: workflowLogicFingerprint(existing.nodes, existing.edges),
          };
          return {
            ...current,
            workflows: [
              ...current.workflows,
              {
                id,
                status: "draft",
                currentVersionId: version.id,
                createdAt: now,
                updatedAt: now,
              },
            ],
            workflowVersions: [...current.workflowVersions, version],
          };
        });
        if (!created) return { ok: false, error: "missing" };
        return { ok: true, data: { id: created } };
      },
      updateCapability: (capabilityId, patch) => {
        if (patch.timeoutMs < 100 || patch.timeoutMs > 30000) {
          return { ok: false, error: "timeout" };
        }
        let found = false;
        setState((current) => ({
          ...current,
          capabilities: current.capabilities.map((item) => {
            if (item.id !== capabilityId) return item;
            found = true;
            return {
              ...item,
              customName: patch.customName?.trim() || undefined,
              timeoutMs: patch.timeoutMs,
              status: patch.status,
            };
          }),
        }));
        if (!found) return { ok: false, error: "missing" };
        return { ok: true, data: { id: capabilityId } };
      },
      startEvaluation: ({ targetType, targetId, datasetId }) => {
        const dataset = datasets.find((item) => item.id === datasetId);
        if (!dataset) return { ok: false, error: "dataset" };
        const runId = createId("ev");
        const planId = createId("plan");
        let failed: string | null = null;
        setState((current) => {
          const now = new Date().toISOString();
          if (targetType === "workflow") {
            const workflow = current.workflows.find((item) => item.id === targetId);
            const version = current.workflowVersions.find(
              (item) => item.id === workflow?.currentVersionId
            );
            if (!workflow || !version) {
              failed = "missing";
              return current;
            }
            if (validateWorkflow(version.nodes, version.edges).length > 0) {
              failed = "invalid";
              return current;
            }
            return commitEvaluation(current, {
              id: runId,
              targetType,
              targetId,
              versionId: version.id,
              fingerprint: version.fingerprint,
              dataset,
              now,
              makePlan: () => planFromWorkflow(current, version, planId, now),
            });
          }
          const rule = current.rules.find((item) => item.id === targetId);
          const version = current.ruleVersions.find((item) => item.id === rule?.currentVersionId);
          if (!rule || !version) {
            failed = "missing";
            return current;
          }
          if (rule.status === "archived") {
            failed = "archived";
            return current;
          }
          return commitEvaluation(current, {
            id: runId,
            targetType,
            targetId,
            versionId: version.id,
            fingerprint: version.fingerprint,
            dataset,
            now,
            makePlan: () => planFromRule(current, version, planId, now),
          });
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: runId } };
      },
      publish: ({ targetType, targetId, note }) => {
        let failed: string | null = null;
        let created = "";
        setState((current) => {
          const gate = releaseGate(current, targetType, targetId);
          if (!gate?.ok) {
            failed = "blocked";
            return current;
          }
          const now = new Date().toISOString();
          const plan =
            current.executionPlans.find(
              (item) =>
                item.targetVersionId === gate.versionId && item.fingerprint === gate.fingerprint
            ) ?? null;
          if (!plan) {
            failed = "plan";
            return current;
          }
          const id = createId("rel");
          created = id;
          if (targetType === "rule") {
            const rule = current.rules.find((item) => item.id === targetId);
            if (!rule) {
              failed = "missing";
              return current;
            }
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === targetId
                  ? {
                      ...item,
                      status: "published" as const,
                      currentVersionId: gate.versionId,
                      publishedVersionId: gate.versionId,
                      updatedAt: now,
                    }
                  : item
              ),
              ruleVersions: current.ruleVersions.map((item) =>
                item.id === gate.versionId ? { ...item, status: "published" as const } : item
              ),
              releases: [
                ...current.releases,
                {
                  id,
                  targetType,
                  targetId,
                  versionId: gate.versionId,
                  previousVersionId: rule.publishedVersionId,
                  executionPlanId: plan.id,
                  action: "publish" as const,
                  note: note.trim() || "Prototype publish.",
                  createdAt: now,
                  actor: "prototype-operator" as const,
                },
              ],
            };
          }
          const workflow = current.workflows.find((item) => item.id === targetId);
          if (!workflow) {
            failed = "missing";
            return current;
          }
          return {
            ...current,
            workflows: current.workflows.map((item) =>
              item.id === targetId
                ? {
                    ...item,
                    status: "published" as const,
                    currentVersionId: gate.versionId,
                    publishedVersionId: gate.versionId,
                    updatedAt: now,
                  }
                : item
            ),
            workflowVersions: current.workflowVersions.map((item) =>
              item.id === gate.versionId ? { ...item, status: "published" as const } : item
            ),
            releases: [
              ...current.releases,
              {
                id,
                targetType,
                targetId,
                versionId: gate.versionId,
                previousVersionId: workflow.publishedVersionId,
                executionPlanId: plan.id,
                action: "publish" as const,
                note: note.trim() || "Prototype publish.",
                createdAt: now,
                actor: "prototype-operator" as const,
              },
            ],
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: created } };
      },
      rollback: ({ targetType, targetId, note }) => {
        let failed: string | null = null;
        let created = "";
        setState((current) => {
          const entity =
            targetType === "rule"
              ? current.rules.find((item) => item.id === targetId)
              : current.workflows.find((item) => item.id === targetId);
          const liveId = entity?.publishedVersionId;
          if (!entity || !liveId) {
            failed = "missing";
            return current;
          }
          const record = [...current.releases]
            .reverse()
            .find(
              (item) =>
                item.targetId === targetId &&
                item.action === "publish" &&
                item.versionId === liveId &&
                item.previousVersionId
            );
          if (!record?.previousVersionId) {
            failed = "no_previous";
            return current;
          }
          const previousId = record.previousVersionId;
          const now = new Date().toISOString();
          const id = createId("rel");
          created = id;
          const release = {
            id,
            targetType,
            targetId,
            versionId: previousId,
            previousVersionId: liveId,
            executionPlanId: record.executionPlanId,
            action: "rollback" as const,
            note: note.trim() || "Prototype rollback.",
            createdAt: now,
            actor: "prototype-operator" as const,
          };
          if (targetType === "rule") {
            return {
              ...current,
              rules: current.rules.map((item) =>
                item.id === targetId
                  ? {
                      ...item,
                      status:
                        item.currentVersionId === liveId
                          ? ("published" as const)
                          : item.status,
                      currentVersionId:
                        item.currentVersionId === liveId ? previousId : item.currentVersionId,
                      publishedVersionId: previousId,
                      updatedAt: now,
                    }
                  : item
              ),
              ruleVersions: current.ruleVersions.map((item) => {
                if (item.id === liveId) return { ...item, status: "rolled_back" as const };
                if (item.id === previousId) return { ...item, status: "published" as const };
                return item;
              }),
              releases: [...current.releases, release],
            };
          }
          return {
            ...current,
            workflows: current.workflows.map((item) =>
              item.id === targetId
                ? {
                    ...item,
                    status:
                      item.currentVersionId === liveId ? ("published" as const) : item.status,
                    currentVersionId:
                      item.currentVersionId === liveId ? previousId : item.currentVersionId,
                    publishedVersionId: previousId,
                    updatedAt: now,
                  }
                : item
            ),
            workflowVersions: current.workflowVersions.map((item) => {
              if (item.id === liveId) return { ...item, status: "rolled_back" as const };
              if (item.id === previousId) return { ...item, status: "published" as const };
              return item;
            }),
            releases: [...current.releases, release],
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: created } };
      },
      retryTask: (taskId) => {
        let failed: string | null = null;
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((task) => {
            if (task.id !== taskId) return task;
            if (task.status !== "failed" && task.status !== "partially_failed") {
              failed = "not_retryable";
              return task;
            }
            return { ...task, status: "running" };
          }),
        }));
        if (failed) return { ok: false, error: failed };
        window.setTimeout(() => {
          setState((current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === taskId && task.status === "running"
                ? {
                    ...task,
                    status: "completed",
                    processed: task.total,
                    failed: 0,
                    failures: [],
                  }
                : task
            ),
          }));
        }, 700);
        return { ok: true, data: { id: taskId } };
      },
      cancelTask: (taskId) => {
        let failed: string | null = null;
        setState((current) => ({
          ...current,
          tasks: current.tasks.map((task) => {
            if (task.id !== taskId) return task;
            if (task.status !== "queued" && task.status !== "running") {
              failed = "not_cancellable";
              return task;
            }
            return { ...task, status: "cancelled" };
          }),
        }));
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: taskId } };
      },
      gateFor: (targetType, targetId) => releaseGate(state, targetType, targetId),
      saveTemplate: (template) => {
        if (!template.name.trim()) return { ok: false, error: "name" };
        const id = template.id || createId("tpl");
        setState((current) => {
          const next = { ...template, id, name: template.name.trim() };
          const exists = current.templates.some((item) => item.id === id);
          return {
            ...current,
            templates: exists
              ? current.templates.map((item) => (item.id === id ? next : item))
              : [...current.templates, next],
          };
        });
        return { ok: true, data: { id } };
      },
      applyTemplate: (templateId, channelId) => {
        let count = 0;
        let failed = "";
        setState((current) => {
          const template = current.templates.find((item) => item.id === templateId);
          const channel = current.channels.find((item) => item.id === channelId);
          const application = current.applications.find((item) => item.id === channel?.applicationId);
          if (!template || !channel || !application || template.ruleIds.length === 0) {
            failed = "missing";
            return current;
          }
          const ruleIds = new Set(template.ruleIds);
          count = current.rules.filter((rule) => ruleIds.has(rule.id)).length;
          if (count === 0) {
            failed = "missing";
            return current;
          }
          return {
            ...current,
            ruleVersions: current.ruleVersions.map((version) => {
              const rule = current.rules.find((item) => item.currentVersionId === version.id);
              if (!rule || !ruleIds.has(rule.id)) return version;
              const labelBindings = [...version.labelBindings];
              for (const labelId of template.labelIds) {
                if (!labelBindings.some((binding) => binding.labelId === labelId && binding.sceneId === channel.sceneId)) {
                  labelBindings.push({ labelId, sceneId: channel.sceneId });
                }
              }
              return {
                ...version,
                tenantId: application.tenantId,
                applicationId: application.id,
                sceneId: channel.sceneId,
                labelBindings,
              };
            }),
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { count } };
      },
      saveSample: (sample) => {
        if (!sample.input.trim()) return { ok: false, error: "name" };
        const id = sample.id || createId("sample");
        const next = { ...sample, id, input: sample.input.trim(), updatedAt: new Date().toISOString() };
        setState((current) => ({
          ...current,
          samples: current.samples.some((item) => item.id === id)
            ? current.samples.map((item) => (item.id === id ? next : item))
            : [...current.samples, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteSample: (id) => {
        setState((current) => ({ ...current, samples: current.samples.filter((item) => item.id !== id) }));
      },
      importSamples: (samples) => {
        setState((current) => ({ ...current, samples: [...current.samples, ...samples] }));
      },
      saveLabel: (label) => {
        if (!label.name.trim() || !label.definition.trim()) return { ok: false, error: "name" };
        const id = label.id || createId("label");
        let failed: string | null = null;
        setState((current) => {
          let depth = 1;
          let parent = label.parentId;
          const seen = new Set<string>();
          while (parent) {
            if (parent === id || seen.has(parent)) {
              failed = "cycle";
              return current;
            }
            seen.add(parent);
            depth += 1;
            parent = current.labels.find((item) => item.id === parent)?.parentId ?? null;
          }
          if (depth > 4) {
            failed = "depth";
            return current;
          }
          const next = {
            ...label,
            id,
            name: label.name.trim(),
            definition: label.definition.trim(),
            annotation: label.annotation ?? "",
            parentId: label.parentId ?? null,
            sceneIds: label.sceneIds ?? [],
            positiveCases: label.positiveCases ?? [],
            negativeCases: label.negativeCases ?? [],
          };
          const exists = current.labels.some((item) => item.id === id);
          return {
            ...current,
            labels: exists
              ? current.labels.map((item) => (item.id === id ? next : item))
              : [...current.labels, next],
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id } };
      },
      saveLlm: (profile) => {
        setState((current) => ({
          ...current,
          llm: { ...profile, updatedAt: new Date().toISOString() },
        }));
      },
      setStorage: (tenantId, enabled) => {
        setState((current) => ({
          ...current,
          storageByTenant: { ...current.storageByTenant, [tenantId]: enabled },
        }));
      },
      addApplication: (tenantId, name) => {
        if (!name.trim()) return { ok: false, error: "name" };
        const id = createId("app");
        setState((current) => ({
          ...current,
          applications: [...current.applications, { id, tenantId, name: name.trim() }],
        }));
        return { ok: true, data: { id } };
      },
      addChannel: (applicationId, name, kind) => {
        if (!name.trim()) return { ok: false, error: "name" };
        const id = createId("ch");
        setState((current) => ({
          ...current,
          channels: [
            ...current.channels,
            { id, applicationId, name: name.trim(), kind, sceneId: "scene_ugc", strategyLabelIds: [] },
          ],
        }));
        return { ok: true, data: { id } };
      },
      setChannelStrategy: (channelId, sceneId, strategyLabelIds) => {
        setState((current) => ({
          ...current,
          channels: current.channels.map((item) =>
            item.id === channelId ? { ...item, sceneId, strategyLabelIds } : item
          ),
        }));
      },
      batchRules: (ids, action) => {
        if (!ids.length) return { ok: false, error: "empty" };
        const selected = new Set(ids);
        setState((current) => {
          if (action === "delete") {
            return {
              ...current,
              rules: current.rules.filter((rule) => !selected.has(rule.id)),
              ruleVersions: current.ruleVersions.filter((version) => !selected.has(version.ruleId)),
            };
          }
          const now = new Date().toISOString();
          const nextStatus = (status: VersionStatus): VersionStatus => {
            if (action === "disable") return "disabled";
            if (action === "close") return "archived";
            if (action === "enable" && (status === "disabled" || status === "archived")) return "draft";
            return status;
          };
          return {
            ...current,
            rules: current.rules.map((rule) =>
              selected.has(rule.id) ? { ...rule, status: nextStatus(rule.status), updatedAt: now } : rule
            ),
            ruleVersions: current.ruleVersions.map((version) => {
              const rule = current.rules.find((item) => item.id === version.ruleId);
              if (!rule || !selected.has(rule.id) || version.id !== rule.currentVersionId) return version;
              return { ...version, status: nextStatus(version.status), updatedAt: now };
            }),
          };
        });
        return { ok: true, data: { count: ids.length } };
      },
      importLabels: (labels) => {
        setState((current) => {
          const next = [...current.labels];
          for (const label of labels) {
            const index = next.findIndex((item) => item.id === label.id);
            if (index >= 0) next[index] = { ...label, annotation: label.annotation ?? "" };
            else next.push({ ...label, annotation: label.annotation ?? "" });
          }
          return { ...current, labels: next };
        });
      },
      saveQuery: (query) => {
        if (!query.name.trim() || !query.sql.trim()) return { ok: false, error: "name" };
        const id = query.id || createId("qry");
        const next = { ...query, id, name: query.name.trim(), sql: query.sql.trim() };
        setState((current) => ({
          ...current,
          savedQueries: current.savedQueries.some((item) => item.id === id)
            ? current.savedQueries.map((item) => (item.id === id ? next : item))
            : [...current.savedQueries, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteQuery: (id) => {
        setState((current) => ({
          ...current,
          savedQueries: current.savedQueries.filter((item) => item.id !== id),
        }));
      },
      saveCaseReview: (review) => {
        setState((current) => ({
          ...current,
          caseReviews: [
            ...current.caseReviews.filter(
              (item) => !(item.runId === review.runId && item.sampleId === review.sampleId)
            ),
            review,
          ],
        }));
      },
      rememberSample: (sample) => {
        setState((current) => ({
          ...current,
          storedSamples: [...current.storedSamples, sample].slice(-30),
        }));
      },
      rollbackCapability: (capabilityId) => {
        let failed: string | null = null;
        setState((current) => {
          const capability = current.capabilities.find((item) => item.id === capabilityId);
          if (!capability) {
            failed = "missing";
            return current;
          }
          const active = capability.versions.find((version) => version.status === "active");
          const previous = [...capability.versions].reverse().find((version) => version.status === "retired");
          if (!active || !previous) {
            failed = "no_previous";
            return current;
          }
          const now = new Date().toISOString();
          return {
            ...current,
            capabilities: current.capabilities.map((item) =>
              item.id !== capabilityId
                ? item
                : {
                    ...item,
                    versions: item.versions.map((version) => {
                      if (version.id === active.id) return { ...version, status: "retired" as const };
                      if (version.id === previous.id) return { ...version, status: "active" as const };
                      return version;
                    }),
                  }
            ),
            releases: [
              ...current.releases,
              {
                id: createId("rel"),
                targetType: "capability" as const,
                targetId: capabilityId,
                versionId: previous.id,
                previousVersionId: active.id,
                executionPlanId: "capability_rollback",
                action: "rollback" as const,
                note: "Prototype capability rollback.",
                createdAt: now,
                actor: "prototype-operator" as const,
              },
            ],
          };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id: capabilityId } };
      },
      deleteLabel: (id) => {
        let failed: string | null = null;
        setState((current) => {
          if (current.labels.some((item) => item.parentId === id)) {
            failed = "has_children";
            return current;
          }
          return { ...current, labels: current.labels.filter((item) => item.id !== id) };
        });
        if (failed) return { ok: false, error: failed };
        return { ok: true, data: { id } };
      },
      saveVariable: (variable) => {
        if (!variable.key.trim() || !variable.name.trim()) return { ok: false, error: "name" };
        const id = variable.id || createId("var");
        const next = { ...variable, id, key: variable.key.trim(), name: variable.name.trim() };
        setState((current) => ({
          ...current,
          variables: current.variables.some((item) => item.id === id)
            ? current.variables.map((item) => (item.id === id ? next : item))
            : [...current.variables, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteVariable: (id) => {
        setState((current) => ({ ...current, variables: current.variables.filter((item) => item.id !== id) }));
      },
      saveLibrary: (entry) => {
        if (!entry.name.trim()) return { ok: false, error: "name" };
        const id = entry.id || createId("lib");
        const next = { ...entry, id, name: entry.name.trim(), updatedAt: new Date().toISOString() };
        setState((current) => ({
          ...current,
          libraries: current.libraries.some((item) => item.id === id)
            ? current.libraries.map((item) => (item.id === id ? next : item))
            : [...current.libraries, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteLibrary: (id) => {
        setState((current) => ({ ...current, libraries: current.libraries.filter((item) => item.id !== id) }));
      },
      importLibraries: (entries) => {
        setState((current) => ({ ...current, libraries: [...current.libraries, ...entries] }));
      },
      saveKnowledge: (doc) => {
        if (!doc.title.trim()) return { ok: false, error: "name" };
        const id = doc.id || createId("kb");
        const next = { ...doc, id, labelIds: doc.labelIds ?? [], title: doc.title.trim(), updatedAt: new Date().toISOString() };
        setState((current) => ({
          ...current,
          knowledge: current.knowledge.some((item) => item.id === id)
            ? current.knowledge.map((item) => (item.id === id ? next : item))
            : [...current.knowledge, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteKnowledge: (id) => {
        setState((current) => ({
          ...current,
          knowledge: current.knowledge.filter((item) => item.id !== id),
          ragEntries: current.ragEntries.filter((item) => item.knowledgeId !== id),
        }));
      },
      savePrompt: (prompt) => {
        if (!prompt.name.trim()) return { ok: false, error: "name" };
        const id = prompt.id || createId("prompt");
        const next = { ...prompt, id, name: prompt.name.trim(), updatedAt: new Date().toISOString() };
        setState((current) => ({
          ...current,
          prompts: current.prompts.some((item) => item.id === id)
            ? current.prompts.map((item) => (item.id === id ? next : item))
            : [...current.prompts, next],
        }));
        return { ok: true, data: { id } };
      },
      deletePrompt: (id) => {
        setState((current) => ({ ...current, prompts: current.prompts.filter((item) => item.id !== id) }));
      },
      saveRag: (entry) => {
        if (!entry.title.trim()) return { ok: false, error: "name" };
        const id = entry.id || createId("rag");
        const next = { ...entry, id, title: entry.title.trim(), updatedAt: new Date().toISOString() };
        setState((current) => ({
          ...current,
          ragEntries: current.ragEntries.some((item) => item.id === id)
            ? current.ragEntries.map((item) => (item.id === id ? next : item))
            : [...current.ragEntries, next],
        }));
        return { ok: true, data: { id } };
      },
      deleteRag: (id) => {
        setState((current) => ({ ...current, ragEntries: current.ragEntries.filter((item) => item.id !== id) }));
      },
      setLlmCases: (cases) => {
        setState((current) => ({ ...current, llmCases: cases }));
      },
    };
  }, [ready, state]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

function commitEvaluation(
  current: PrototypeState,
  input: {
    id: string;
    targetType: "rule" | "workflow";
    targetId: string;
    versionId: string;
    fingerprint: string;
    dataset: (typeof datasets)[number];
    now: string;
    makePlan: () => PrototypeState["executionPlans"][number];
  }
): PrototypeState {
  const existingPlan = current.executionPlans.find(
    (plan) => plan.targetVersionId === input.versionId && plan.fingerprint === input.fingerprint
  );
  const plan = existingPlan ?? input.makePlan();
  const cases = casesForDataset(input.dataset);
  const failed = cases.some((item) => item.status === "regressed");
  const id = input.id;
  const run = {
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    targetVersionId: input.versionId,
    datasetId: input.dataset.id,
    kind: input.dataset.kind,
    executionPlanId: plan.id,
    status: failed ? ("failed" as const) : ("passed" as const),
    total: cases.length,
    decisionCounts: summarizeCases(cases),
    changedCount: cases.filter((item) => item.changed).length,
    cases,
    createdAt: input.now,
  };
  const next: PrototypeState = {
    ...current,
    executionPlans: existingPlan ? current.executionPlans : [...current.executionPlans, plan],
    evaluations: [...current.evaluations, run],
  };
  const mirrorPassed =
    (input.dataset.kind === "mirror" ? run.status === "passed" : false) ||
    next.evaluations.some((item) => {
      if (item.targetVersionId !== input.versionId || item.kind !== "mirror") return false;
      const itemPlan = next.executionPlans.find((planItem) => planItem.id === item.executionPlanId);
      return itemPlan?.fingerprint === input.fingerprint && item.status === "passed";
    });
  const baselinePassed = next.evaluations
    .filter((item) => {
      if (item.targetVersionId !== input.versionId || item.kind !== "baseline") return false;
      const itemPlan = next.executionPlans.find((planItem) => planItem.id === item.executionPlanId);
      return itemPlan?.fingerprint === input.fingerprint;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.status === "passed";

  if (input.targetType === "rule") {
    const rule = next.rules.find((item) => item.id === input.targetId);
    if (!rule || rule.publishedVersionId === input.versionId || rule.status === "archived") {
      return next;
    }
    const status = statusAfterEvaluation(rule.status, mirrorPassed, baselinePassed);
    return {
      ...next,
      rules: next.rules.map((item) =>
        item.id === input.targetId ? { ...item, status, updatedAt: input.now } : item
      ),
      ruleVersions: next.ruleVersions.map((item) =>
        item.id === input.versionId ? { ...item, status } : item
      ),
    };
  }

  const workflow = next.workflows.find((item) => item.id === input.targetId);
  if (!workflow || workflow.publishedVersionId === input.versionId) return next;
  const status = statusAfterEvaluation("draft", mirrorPassed, baselinePassed);
  return {
    ...next,
    workflows: next.workflows.map((item) =>
      item.id === input.targetId ? { ...item, status, updatedAt: input.now } : item
    ),
    workflowVersions: next.workflowVersions.map((item) =>
      item.id === input.versionId ? { ...item, status } : item
    ),
  };
}

export function usePrototypeStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) {
    throw new Error("usePrototypeStore must be used within PrototypeStoreProvider");
  }
  return value;
}
