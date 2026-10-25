"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  EmptyState,
  ErrorBlock,
  Field,
  SimpleSelect,
  StatusBadge,
  useToast,
} from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createId } from "@/lib/platform/hash";
import { usePrototypeStore } from "@/lib/platform/store";
import type { Decision, WfEdge, WfNode, WorkflowNodeType } from "@/lib/platform/types";
import {
  simulateWorkflow,
  validateWorkflow,
  type SimInput,
  type SimResult,
  type WorkflowIssue,
} from "@/lib/platform/workflow-engine";
import { cn } from "@/lib/utils";

type FlowData = {
  nodeType: WorkflowNodeType;
  label: string;
  labelIsDefault?: boolean;
  running?: boolean;
  ruleId?: string;
  ruleVersionId?: string;
  capabilityId?: string;
  timeoutMs?: number;
  purpose?: WfNode["purpose"];
  field?: WfNode["field"];
  operator?: WfNode["operator"];
  value?: string;
  mergeMode?: WfNode["mergeMode"];
  apiMethod?: WfNode["apiMethod"];
  apiPath?: string;
  apiTimeoutMs?: number;
  promptId?: string;
  ragId?: string;
};

type FlowNode = Node<FlowData, "workflow">;

const nodeTypes = { workflow: WorkflowNodeCard };

const palette: WorkflowNodeType[] = [
  "start",
  "rule_execution",
  "model_invocation",
  "llm",
  "condition_branch",
  "result_merge",
  "end",
];

function WorkflowNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const t = useTranslations("Workflows");
  const title = data.labelIsDefault ? t(`nodeTypes.${data.nodeType}`) : data.label;
  return (
    <div
      className={cn(
        "w-48 rounded-lg border bg-white px-3 py-2 text-left shadow-sm",
        selected ? "border-blue-600 ring-2 ring-blue-100" : "border-slate-300",
        data.running && "border-amber-500 bg-amber-50"
      )}
    >
      {data.nodeType !== "start" ? <Handle type="target" position={Position.Left} /> : null}
      <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
        {t(`nodeTypes.${data.nodeType}`)}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-950">{title}</p>
      {data.nodeType === "condition_branch" ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: 22 }} />
          <Handle id="false" type="source" position={Position.Right} style={{ top: 48 }} />
        </>
      ) : data.nodeType !== "end" ? (
        <Handle type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

function toFlow(nodes: WfNode[], edges: WfEdge[]): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: "workflow",
      position: node.position,
      data: {
        nodeType: node.type,
        label: node.label,
        labelIsDefault: node.labelIsDefault,
        ruleId: node.ruleId,
        ruleVersionId: node.ruleVersionId,
        capabilityId: node.capabilityId,
        timeoutMs: node.timeoutMs,
        purpose: node.purpose,
        apiMethod: node.apiMethod,
        apiPath: node.apiPath,
        apiTimeoutMs: node.apiTimeoutMs,
        promptId: node.promptId,
        ragId: node.ragId,
        field: node.field,
        operator: node.operator,
        value: node.value,
        mergeMode: node.mergeMode,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      label: edge.sourceHandle,
    })),
  };
}

function fromFlow(nodes: FlowNode[], edges: Edge[]): { nodes: WfNode[]; edges: WfEdge[] } {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      position: node.position,
      label: node.data.label,
      labelIsDefault: node.data.labelIsDefault,
      ruleId: node.data.ruleId,
      ruleVersionId: node.data.ruleVersionId,
      capabilityId: node.data.capabilityId,
      timeoutMs: node.data.timeoutMs,
      purpose: node.data.purpose,
      apiMethod: node.data.apiMethod,
      apiPath: node.data.apiPath,
      apiTimeoutMs: node.data.apiTimeoutMs,
      promptId: node.data.promptId,
      ragId: node.data.ragId,
      field: node.data.field,
      operator: node.data.operator,
      value: node.data.value,
      mergeMode: node.data.mergeMode,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle:
        edge.sourceHandle === "true" || edge.sourceHandle === "false"
          ? edge.sourceHandle
          : undefined,
    })),
  };
}

function defaultData(type: WorkflowNodeType): FlowData {
  if (type === "llm") {
    return {
      nodeType: type,
      label: type,
      labelIsDefault: true,
      capabilityId: "cap_text_llm",
      timeoutMs: 4000,
      purpose: "classify",
      apiMethod: "POST",
      apiPath: "",
      apiTimeoutMs: 4000,
    };
  }
  if (type === "model_invocation") {
    return {
      nodeType: type,
      label: type,
      labelIsDefault: true,
      capabilityId: "cap_text_small",
      timeoutMs: 2000,
      purpose: "classify",
    };
  }
  if (type === "condition_branch") {
    return {
      nodeType: type,
      label: type,
      labelIsDefault: true,
      field: "rule_hit",
      operator: "eq",
      value: "true",
    };
  }
  if (type === "result_merge") {
    return { nodeType: type, label: type, labelIsDefault: true, mergeMode: "block_first" };
  }
  if (type === "rule_execution") {
    return { nodeType: type, label: type, labelIsDefault: true };
  }
  return { nodeType: type, label: type, labelIsDefault: true };
}

export function WorkflowEditor() {
  const t = useTranslations("Workflows");
  const enums = useTranslations("Enums");
  const site = useTranslations("Site");
  const store = usePrototypeStore();
  const { notify } = useToast();
  const [workflowId, setWorkflowId] = useState("wf_example");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<WorkflowIssue[]>([]);
  const [sample, setSample] = useState<SimInput>("rule_hit");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loadedKey, setLoadedKey] = useState("");

  const workflow = store.state.workflows.find((item) => item.id === workflowId);
  const version = store.state.workflowVersions.find(
    (item) => item.id === workflow?.currentVersionId
  );
  const selected = nodes.find((node) => node.id === selectedId) ?? null;

  useEffect(() => {
    if (!version) return;
    const key = `${workflowId}:${version.id}`;
    if (loadedKey === key) return;
    const mapped = toFlow(version.nodes, version.edges);
    setNodes(mapped.nodes);
    setEdges(mapped.edges);
    setName(version.name);
    setDescription(version.description);
    setChangeSummary("");
    setIssues([]);
    setResult(null);
    setSelectedId(null);
    setLoadedKey(key);
  }, [loadedKey, setEdges, setNodes, version, workflowId]);

  const graph = useMemo(() => fromFlow(nodes, edges), [edges, nodes]);
  const savedKey = JSON.stringify({
    name: version?.name,
    description: version?.description,
    nodes: version?.nodes,
    edges: version?.edges,
  });
  const currentKey = JSON.stringify({
    name,
    description,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  const dirty = Boolean(version) && savedKey !== currentKey;

  function updateSelected(patch: Partial<FlowData>) {
    if (!selectedId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node
      )
    );
  }

  function addNode(type: WorkflowNodeType) {
    const id = createId("node");
    setNodes((current) => [
      ...current,
      {
        id,
        type: "workflow",
        position: { x: 80 + (current.length % 3) * 40, y: 80 + current.length * 20 },
        data: defaultData(type),
      },
    ]);
    setSelectedId(id);
  }

  function removeSelected() {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId)
    );
    setSelectedId(null);
  }

  function save() {
    if (!workflowId) return;
    const resultSave = store.saveWorkflow(workflowId, {
      name,
      description,
      nodes: graph.nodes,
      edges: graph.edges,
      changeSummary,
    });
    if (!resultSave.ok) {
      notify({ tone: "error", title: t("saveFailed") });
      return;
    }
    notify({
      tone: "success",
      title: resultSave.data.forked ? t("forked") : t("saved"),
      description: resultSave.data.forked ? t("forkedHelp") : undefined,
    });
    setLoadedKey("");
  }

  function validate() {
    const next = validateWorkflow(graph.nodes, graph.edges);
    setIssues(next);
    notify({
      tone: next.length ? "error" : "success",
      title: next.length ? t("invalid") : t("valid"),
    });
  }

  async function run() {
    setRunning(true);
    setResult(null);
    const simulated = simulateWorkflow(graph.nodes, graph.edges, sample);
    if (!simulated.ok && simulated.steps.length === 0) {
      setIssues(simulated.issues);
      setResult(simulated);
      setRunning(false);
      return;
    }
    for (const step of simulated.steps) {
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: { ...node.data, running: node.id === step.nodeId },
        }))
      );
      setResult({ ...simulated, steps: simulated.steps.slice(0, simulated.steps.indexOf(step) + 1) });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, running: false } })));
    setResult(simulated);
    setIssues(simulated.issues);
    setRunning(false);
  }

  if (!workflow || !version) {
    return <EmptyState title={t("missingTitle")} description={t("missingBody")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{t("title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const created = store.createWorkflow(t("newName"), t("newDescription"));
              if (created.ok) {
                setWorkflowId(created.data.id);
                setLoadedKey("");
                notify({ tone: "success", title: t("created") });
              }
            }}
          >
            {t("create")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const copied = store.copyWorkflow(workflowId, `${name} ${t("copySuffix")}`);
              if (copied.ok) {
                setWorkflowId(copied.data.id);
                setLoadedKey("");
                notify({ tone: "success", title: t("copied") });
              }
            }}
          >
            {site("copy")}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[1.2fr_1fr_auto]">
        <Field label={t("workflow")}>
          <SimpleSelect
            value={workflowId}
            onChange={(value) => {
              if (dirty && !window.confirm(t("discard"))) return;
              setWorkflowId(value);
              setLoadedKey("");
            }}
            options={store.state.workflows.map((item) => {
              const current = store.state.workflowVersions.find(
                (versionItem) => versionItem.id === item.currentVersionId
              );
              return { value: item.id, label: current?.name ?? item.id };
            })}
          />
        </Field>
        <Field label={t("name")}>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="flex items-end gap-2">
          <StatusBadge value={workflow.status} />
          <span className="pb-2 text-xs text-slate-500">
            v{version.version} · {dirty ? t("unsaved") : t("savedState")}
          </span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <aside className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t("palette")}</p>
          <div className="mt-3 flex flex-col gap-2">
            {palette.map((type) => (
              <Button key={type} variant="outline" onClick={() => addNode(type)}>
                {t(`nodeTypes.${type}`)}
              </Button>
            ))}
          </div>
        </aside>
        <div className="h-[640px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onConnect={(connection: Connection) =>
              setEdges((current) => addEdge({ ...connection, id: createId("edge") }, current))
            }
            onNodeClick={(_, node) => setSelectedId(node.id)}
            fitView
            colorMode="light"
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{t("inspector")}</p>
          {selected ? (
            <NodeInspector
              node={selected}
              onChange={updateSelected}
              onDelete={removeSelected}
            />
          ) : (
            <p className="text-sm text-slate-500">{t("selectNode")}</p>
          )}
          <Field label={t("descriptionLabel")}>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label={t("summary")}>
            <Input value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} />
          </Field>
        </aside>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Button onClick={save}>{site("save")}</Button>
        <Button variant="outline" onClick={validate}>
          {t("validate")}
        </Button>
        <Field label={t("sample")}>
          <SimpleSelect
            value={sample}
            onChange={(value) => setSample(value as SimInput)}
            options={["clean", "rule_hit", "model_risk", "model_timeout"].map((item) => ({
              value: item,
              label: t(`samples.${item}`),
            }))}
          />
        </Field>
        <Button onClick={run} disabled={running}>
          {running ? t("running") : t("run")}
        </Button>
        <p className="text-xs text-slate-500">{t("simNotice")}</p>
      </div>

      {issues.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">{t("issueTitle")}</p>
          <ul className="mt-2 space-y-1">
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.nodeId ?? index}`}>
                <button
                  type="button"
                  className="text-left text-sm text-red-800 underline-offset-2 hover:underline"
                  onClick={() => issue.nodeId && setSelectedId(issue.nodeId)}
                >
                  {t(`issues.${issue.code}`)}
                  {issue.nodeId ? ` · ${issue.nodeId}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t("resultTitle")}</p>
            {result.finalStatus === "error" || result.decision === null ? (
              <ErrorBlock title={t("resultError")} description={t(`reasons.${result.reason}`)} />
            ) : (
              <p className="text-sm text-slate-700">
                {t("finalDecision")}: {enums(`decision.${result.decision as Decision}`)}
              </p>
            )}
          </div>
          <ol className="mt-3 space-y-2">
            {result.steps.map((step, index) => (
              <li key={`${step.nodeId}-${index}`} className="rounded-lg border border-slate-200 p-2 text-sm">
                <p className="font-medium">
                  {index + 1}. {step.label} · {t(`nodeTypes.${step.nodeType}`)} · {step.status}
                </p>
                <pre className="mt-1 overflow-x-auto text-xs text-slate-600">
                  {JSON.stringify({ input: step.input, output: step.output }, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function NodeInspector({
  node,
  onChange,
  onDelete,
}: {
  node: FlowNode;
  onChange: (patch: Partial<FlowData>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Workflows");
  const enums = useTranslations("Enums");
  const store = usePrototypeStore();
  const ruleVersions = store.state.ruleVersions.filter((version) => version.ruleId === node.data.ruleId);

  return (
    <div className="space-y-3">
      <Field label={t("nodeName")}>
        <Input
          value={node.data.labelIsDefault ? t(`nodeTypes.${node.data.nodeType}`) : node.data.label}
          onChange={(event) =>
            onChange({ label: event.target.value, labelIsDefault: false })
          }
        />
      </Field>
      {node.data.nodeType === "rule_execution" ? (
        <>
          <Field label={t("rule")}>
            <SimpleSelect
              value={node.data.ruleId ?? "unset"}
              onChange={(value) => {
                if (value === "unset") {
                  onChange({ ruleId: undefined, ruleVersionId: undefined });
                  return;
                }
                const match = store.state.rules.find((rule) => rule.id === value);
                onChange({ ruleId: value, ruleVersionId: match?.currentVersionId });
              }}
              options={[
                { value: "unset", label: t("choose") },
                ...store.state.rules.map((rule) => {
                  const version = store.state.ruleVersions.find(
                    (item) => item.id === rule.currentVersionId
                  );
                  return { value: rule.id, label: version?.name ?? rule.id };
                }),
              ]}
            />
          </Field>
          <Field label={t("ruleVersion")}>
            <SimpleSelect
              value={node.data.ruleVersionId ?? "unset"}
              onChange={(value) =>
                onChange({ ruleVersionId: value === "unset" ? undefined : value })
              }
              options={[
                { value: "unset", label: t("choose") },
                ...ruleVersions.map((version) => ({
                  value: version.id,
                  label: `v${version.version}`,
                })),
              ]}
            />
          </Field>
        </>
      ) : null}
      {node.data.nodeType === "model_invocation" ? (
        <>
          <Field label={t("capability")}>
            <SimpleSelect
              value={node.data.capabilityId ?? "unset"}
              onChange={(value) =>
                onChange({ capabilityId: value === "unset" ? undefined : value })
              }
              options={[
                { value: "unset", label: t("choose") },
                ...store.state.capabilities.map((item) => ({
                  value: item.id,
                  label: item.customName ?? enums(`capabilities.${item.id}`),
                })),
              ]}
            />
          </Field>
          <Field label={t("purpose")}>
            <SimpleSelect
              value={node.data.purpose ?? "classify"}
              onChange={(value) => onChange({ purpose: value as FlowData["purpose"] })}
              options={["classify", "score", "explain"].map((item) => ({
                value: item,
                label: t(`purposes.${item}`),
              }))}
            />
          </Field>
          <Field label={t("timeout")}>
            <Input
              type="number"
              value={node.data.timeoutMs ?? 2000}
              onChange={(event) => onChange({ timeoutMs: Number(event.target.value) })}
            />
          </Field>
        </>
      ) : null}
      {node.data.nodeType === "condition_branch" ? (
        <>
          <Field label={t("field")}>
            <SimpleSelect
              value={node.data.field ?? "rule_hit"}
              onChange={(value) => onChange({ field: value as FlowData["field"] })}
              options={["rule_hit", "risk_score", "label_present"].map((item) => ({
                value: item,
                label: t(`fields.${item}`),
              }))}
            />
          </Field>
          <Field label={t("operator")}>
            <SimpleSelect
              value={node.data.operator ?? "eq"}
              onChange={(value) => onChange({ operator: value as FlowData["operator"] })}
              options={["eq", "neq", "gt", "lt"].map((item) => ({
                value: item,
                label: enums(`operator.${item}`),
              }))}
            />
          </Field>
          <Field label={t("value")}>
            <Input
              value={node.data.value ?? ""}
              onChange={(event) => onChange({ value: event.target.value })}
            />
          </Field>
          <p className="text-xs text-slate-500">{t("branchHelp")}</p>
        </>
      ) : null}
      {node.data.nodeType === "result_merge" ? (
        <Field label={t("merge")}>
          <SimpleSelect
            value={node.data.mergeMode ?? "block_first"}
            onChange={(value) => onChange({ mergeMode: value as FlowData["mergeMode"] })}
            options={["block_first", "priority", "conflict_review"].map((item) => ({
              value: item,
              label: t(`mergeModes.${item}.label`),
            }))}
          />
          <p className="text-xs text-slate-500">{t(`mergeModes.${node.data.mergeMode ?? "block_first"}.help`)}</p>
        </Field>
      ) : null}
      {node.data.nodeType === "llm" ? (
        <>
          <Field label={t("llmModel")}>
            <SimpleSelect
              value={node.data.capabilityId ?? "unset"}
              onChange={(value) => onChange({ capabilityId: value === "unset" ? undefined : value })}
              options={[
                { value: "unset", label: t("choose") },
                ...store.state.capabilities
                  .filter((item) => item.type === "inhouse_llm")
                  .map((item) => ({
                    value: item.id,
                    label: item.customName ?? enums(`capabilities.${item.id}`),
                  })),
              ]}
            />
          </Field>
          <Field label={t("llmPrompt")}>
            <SimpleSelect
              value={node.data.promptId ?? "unset"}
              onChange={(value) => onChange({ promptId: value === "unset" ? undefined : value })}
              options={[
                { value: "unset", label: t("choose") },
                ...store.state.prompts.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          </Field>
          <Field label={t("llmRag")}>
            <SimpleSelect
              value={node.data.ragId ?? "unset"}
              onChange={(value) => onChange({ ragId: value === "unset" ? undefined : value })}
              options={[
                { value: "unset", label: t("choose") },
                ...store.state.ragEntries.map((item) => ({ value: item.id, label: item.title })),
              ]}
            />
          </Field>
          <Field label={t("timeout")}>
            <Input
              type="number"
              value={node.data.timeoutMs ?? 4000}
              onChange={(event) => onChange({ timeoutMs: Number(event.target.value) })}
            />
          </Field>
        </>
      ) : null}
      <Field label={t("apiMethod")}>
        <SimpleSelect
          value={node.data.apiMethod ?? "POST"}
          onChange={(value) => onChange({ apiMethod: value as FlowData["apiMethod"] })}
          options={[
            { value: "POST", label: "POST" },
            { value: "GET", label: "GET" },
          ]}
        />
      </Field>
      <Field label={t("apiPath")}>
        <Input
          value={node.data.apiPath ?? ""}
          placeholder="/v1/moderate"
          onChange={(event) => onChange({ apiPath: event.target.value })}
        />
      </Field>
      <Field label={t("apiTimeout")}>
        <Input
          type="number"
          value={node.data.apiTimeoutMs ?? 2000}
          onChange={(event) => onChange({ apiTimeoutMs: Number(event.target.value) })}
        />
      </Field>
      <p className="text-xs text-slate-500">{t("apiNotice")}</p>
      <Button variant="outline" onClick={onDelete}>
        {t("deleteNode")}
      </Button>
    </div>
  );
}
