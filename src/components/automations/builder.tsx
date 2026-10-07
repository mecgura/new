"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, FlaskConical, History, ListChecks, Pause, Play, Plus, Redo2, Rocket, Save, Settings2, Undo2, Workflow } from "lucide-react";
import { Alert, Badge, Button, Drawer, Dropdown, DropdownItem, Field, IconButton, Input, Modal, Select, Textarea, useToast } from "@/components/ds";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client-api";
import { NODE_LABELS, defaultData, handlesOf, validateGraph, type FlowEdge, type FlowNode, type Graph, type NodeType } from "@/lib/automations";
import { useRealtime } from "@/components/inbox/use-realtime";
import type { TemplateView } from "@/components/templates/types";
import type { TeamMember, Tag } from "@/components/inbox/types";
import { BuilderContext, FlowNodeCard, type BuilderInfo } from "@/components/automations/flow-node";
import { NodeInspector, WebhookTriggerInfo, type Lists } from "@/components/automations/inspector";
import { AUTO_STATUS, NODE_ACCENT, NODE_ICON, PALETTE, nodeTitle } from "@/components/automations/meta";
import { AnalyticsPanel, DrawerHeader, ExecutionDrawer, LogsPanel, TestModal, VersionsPanel, type VersionRow } from "@/components/automations/panels";

export type AutomationView = {
  id: string;
  name: string;
  description: string;
  status: string;
  triggerType: string;
  currentVersion: number;
  published: boolean;
  account: { id: string; displayName: string; phoneNumber: string; isDemo: boolean } | null;
  settings: { reentry?: string };
  hasWebhookSecret: boolean;
  graph: Graph;
  versions: VersionRow[];
};

type Account = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };
type RFNode = Node<Record<string, unknown>, NodeType>;
type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };
type Meta = { name: string; description: string; whatsappAccountId: string; reentry: "always" | "once" };

const nodeTypes = Object.fromEntries((["trigger", "message", "template", "delay", "condition", "tag", "assign", "update_contact", "webhook", "ai_response", "end"] as const).map((t) => [t, FlowNodeCard]));

const EDGE_STYLE = { strokeWidth: 2, stroke: "var(--color-app-border-strong)" };

function toRFEdge(e: FlowEdge, nodes: FlowNode[]): Edge {
  const src = nodes.find((n) => n.id === e.source);
  const handle = src?.type === "condition" ? (e.sourceHandle ?? "yes") : "next";
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: handle,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: handle === "yes" ? { ...EDGE_STYLE, stroke: "#34d399" } : handle === "no" ? { ...EDGE_STYLE, stroke: "#f87171" } : EDGE_STYLE,
    label: handle === "yes" ? "Yes" : handle === "no" ? "No" : undefined,
    labelStyle: { fill: "var(--color-app-muted)", fontSize: 10 },
    labelBgStyle: { fill: "var(--color-app-surface)" },
  };
}

function toRF(g: Graph): { nodes: RFNode[]; edges: Edge[] } {
  return {
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as Record<string, unknown>, deletable: n.type !== "trigger" })),
    edges: g.edges.map((e) => toRFEdge(e, g.nodes)),
  };
}

function toGraph(nodes: RFNode[], edges: Edge[]): Graph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data as FlowNode["data"] })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  };
}

const newId = (type: string) => `${type}_${Math.random().toString(36).slice(2, 8)}`;

function useWide() {
  return React.useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 1280px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => true
  );
}

export function AutomationBuilder(props: { orgId: string; automation: AutomationView; accounts: Account[]; canManage: boolean }) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({ orgId, automation, accounts, canManage }: { orgId: string; automation: AutomationView; accounts: Account[]; canManage: boolean }) {
  const search = useSearchParams();
  const toast = useToast();
  const rf = useReactFlow();
  const wide = useWide();
  const base = `/api/organizations/${orgId}/automations/${automation.id}`;
  const readOnly = !canManage;

  const [a, setA] = React.useState(automation);
  const initial = React.useMemo(() => toRF(automation.graph), [automation.graph]);
  const [nodes, setNodes] = React.useState<RFNode[]>(initial.nodes);
  const [edges, setEdges] = React.useState<Edge[]>(initial.edges);
  const [meta, setMeta] = React.useState<Meta>({ name: automation.name, description: automation.description, whatsappAccountId: automation.account?.id ?? "", reentry: automation.settings.reentry === "once" ? "once" : "always" });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<string>(search.get("tab") ?? "builder");
  const [saved, setSaved] = React.useState(() => JSON.stringify({ g: toGraph(initial.nodes, initial.edges), meta: { name: automation.name, description: automation.description, whatsappAccountId: automation.account?.id ?? "", reentry: automation.settings.reentry === "once" ? "once" : "always" } }));
  const [busy, setBusy] = React.useState<"" | "save" | "publish" | "status">("");
  const [serverIssues, setServerIssues] = React.useState<{ nodeId?: string; message: string }[]>([]);
  const [issuesOpen, setIssuesOpen] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [execId, setExecId] = React.useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = React.useState<string | null>(null);
  const [showStats, setShowStats] = React.useState(false);
  const [stats, setStats] = React.useState<Record<string, Record<string, number>> | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [lists, setLists] = React.useState<Lists>({ templates: [], members: [], tags: [], accounts });

  // History (undo/redo) — snapshots of the graph, taken before each change.
  const past = React.useRef<Snapshot[]>([]);
  const future = React.useRef<Snapshot[]>([]);
  const lastEdit = React.useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [hist, setHist] = React.useState({ undo: 0, redo: 0 });
  const syncHistory = () => setHist({ undo: past.current.length, redo: future.current.length });
  const current = React.useRef({ nodes, edges });
  React.useEffect(() => {
    current.current = { nodes, edges };
  }, [nodes, edges]);

  const snapshot = (): Snapshot => {
    const g = toGraph(current.current.nodes, current.current.edges);
    return structuredClone({ nodes: g.nodes, edges: g.edges });
  };
  const remember = React.useCallback((coalesceKey?: string) => {
    const now = Date.now();
    if (coalesceKey && lastEdit.current.key === coalesceKey && now - lastEdit.current.at < 1200) {
      lastEdit.current.at = now;
      return;
    }
    lastEdit.current = { key: coalesceKey ?? "", at: now };
    past.current.push(snapshot());
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    syncHistory();
  }, []);
  const restore = (s: Snapshot) => {
    const r = toRF(s);
    setNodes(r.nodes);
    setEdges(r.edges);
  };
  const undo = React.useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshot());
    restore(prev);
    lastEdit.current = { key: "", at: 0 };
    syncHistory();
  }, []);
  const redo = React.useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    restore(next);
    lastEdit.current = { key: "", at: 0 };
    syncHistory();
  }, []);

  // Lookup data for the inspector.
  React.useEffect(() => {
    void Promise.all([
      apiFetch<{ templates: TemplateView[] }>(`/api/organizations/${orgId}/templates?status=approved`),
      apiFetch<{ members: TeamMember[] }>(`/api/organizations/${orgId}/team`),
      apiFetch<{ tags: Tag[] }>(`/api/organizations/${orgId}/tags`),
    ]).then(([t, m, tg]) =>
      setLists((l) => ({
        ...l,
        templates: t.ok ? t.data.templates.filter((x) => x.category !== "AUTHENTICATION").map((x) => ({ id: x.id, name: x.name, language: x.language, category: x.category, slots: x.slots, numbers: x.waba.numbers.map((nn) => nn.id) })) : [],
        members: m.ok ? m.data.members.map((x) => ({ userId: x.userId, name: x.name, role: x.role })) : [],
        tags: tg.ok ? tg.data.tags.map((x) => x.name) : [],
      }))
    );
  }, [orgId]);

  const graph = React.useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const validation = React.useMemo(() => validateGraph(graph), [graph]);
  const allIssues = React.useMemo(() => [...validation.errors, ...serverIssues], [validation.errors, serverIssues]);
  const issuesByNode = React.useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const i of allIssues) if (i.nodeId) (m[i.nodeId] ??= []).push(i.message);
    return m;
  }, [allIssues]);
  const dirty = JSON.stringify({ g: graph, meta }) !== saved;

  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Live updates (runs, publishes) — refetches coalesced.
  const pending = React.useRef<number | null>(null);
  const live = useRealtime(
    orgId,
    (e) => {
      if (e.type !== "automation.updated" || e.automationId !== automation.id || pending.current) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        setRefreshKey((k) => k + 1);
      }, 1200);
    },
    () => setRefreshKey((k) => k + 1)
  );

  React.useEffect(() => {
    if (!showStats) return;
    void apiFetch<{ nodes: Record<string, Record<string, number>> }>(`${base}/analytics`).then((r) => r.ok && setStats(r.data.nodes));
  }, [showStats, base, refreshKey]);

  const info: BuilderInfo = React.useMemo(
    () => ({
      issues: issuesByNode,
      stats: showStats ? stats ?? {} : null,
      names: { templates: Object.fromEntries(lists.templates.map((t) => [t.id, `${t.name} (${t.language})`])), users: Object.fromEntries(lists.members.map((m) => [m.userId, m.name])) },
      activeNodeId,
    }),
    [issuesByNode, showStats, stats, lists, activeNodeId]
  );

  // ----- canvas events -----
  const onNodesChange = React.useCallback(
    (changes: NodeChange<RFNode>[]) => {
      if (readOnly) changes = changes.filter((c) => c.type === "select" || c.type === "dimensions");
      if (changes.some((c) => c.type === "remove")) remember();
      setNodes((ns) => applyNodeChanges(changes, ns));
      for (const c of changes) {
        if (c.type === "select" && c.selected) setSelectedId(c.id);
        if (c.type === "remove") setSelectedId((s) => (s === c.id ? null : s));
      }
    },
    [readOnly, remember]
  );
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      if (changes.some((c) => c.type === "remove")) remember();
      setEdges((es) => applyEdgeChanges(changes, es));
    },
    [readOnly, remember]
  );
  const isValidConnection = React.useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false;
      const target = current.current.nodes.find((n) => n.id === c.target);
      return Boolean(target && target.type !== "trigger");
    },
    []
  );
  const onConnect = React.useCallback(
    (c: Connection) => {
      if (readOnly) return;
      remember();
      const src = current.current.nodes.find((n) => n.id === c.source);
      const handle = src?.type === "condition" ? (c.sourceHandle ?? "yes") : "next";
      const g = toGraph(current.current.nodes, current.current.edges);
      // One connection per output: reconnecting replaces the old one.
      setEdges((es) => [...es.filter((e) => !(e.source === c.source && (src?.type !== "condition" || e.sourceHandle === handle))), toRFEdge({ id: `e_${c.source}_${handle}_${c.target}_${Date.now().toString(36)}`, source: c.source, target: c.target, sourceHandle: handle }, g.nodes)]);
    },
    [readOnly, remember]
  );

  function addNode(type: NodeType, at?: { x: number; y: number }) {
    if (readOnly) return;
    remember();
    const id = newId(type);
    const nodesNow = current.current.nodes;
    const from = nodesNow.find((n) => n.id === selectedId) ?? null;
    let position = at;
    let link: FlowEdge | null = null;
    if (!position) {
      const anchor = from ?? [...nodesNow].sort((x, y) => y.position.y - x.position.y)[0];
      position = anchor ? { x: anchor.position.x, y: anchor.position.y + 170 } : { x: 260, y: 0 };
      if (from && from.type !== "end") {
        const used = current.current.edges.filter((e) => e.source === from.id).map((e) => e.sourceHandle ?? "next");
        const free = handlesOf(from.type as NodeType).find((h) => !used.includes(h));
        if (free) {
          link = { id: `e_${from.id}_${free}_${id}`, source: from.id, target: id, sourceHandle: free };
          if (free === "no") position = { x: from.position.x + 300, y: from.position.y + 170 };
        }
      }
    }
    const node: RFNode = { id, type, position, data: { ...defaultData(type), label: NODE_LABELS[type] } as Record<string, unknown>, deletable: true, selected: true };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node]);
    if (link) {
      const g = toGraph([...nodesNow, node], []);
      setEdges((es) => [...es, toRFEdge(link!, g.nodes)]);
    }
    setSelectedId(id);
    requestAnimationFrame(() => rf.setCenter(position!.x + 124, position!.y + 60, { zoom: rf.getZoom(), duration: 300 }));
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/mecgura-node") as NodeType;
    if (!type) return;
    addNode(type, rf.screenToFlowPosition({ x: e.clientX - 124, y: e.clientY - 30 }));
  };

  function updateNodeData(id: string, data: FlowNode["data"]) {
    remember(`data:${id}`);
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: data as Record<string, unknown> } : n)));
    setServerIssues((s) => s.filter((x) => x.nodeId !== id));
  }
  function deleteNode(id: string) {
    remember();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  }

  // ----- persistence -----
  async function save(): Promise<boolean> {
    if (readOnly) return false;
    setBusy("save");
    const r = await apiFetch<{ automation: AutomationView }>(base, {
      method: "PATCH",
      body: { graph, name: meta.name.trim() || a.name, description: meta.description, whatsappAccountId: meta.whatsappAccountId || null, settings: { reentry: meta.reentry } },
    });
    setBusy("");
    if (!r.ok) {
      toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
      return false;
    }
    setA(r.data.automation);
    setSaved(JSON.stringify({ g: graph, meta }));
    return true;
  }
  async function onSave() {
    if (await save()) toast("Draft saved");
  }
  async function publish(note: string) {
    if (dirty && !(await save())) return;
    setBusy("publish");
    const r = await apiFetch<{ automation: AutomationView; warnings: { nodeId?: string; message: string }[] }>(`${base}/publish`, { method: "POST", body: { note } });
    setBusy("");
    setPublishOpen(false);
    if (!r.ok) {
      const issues = Object.entries(r.details ?? {}).map(([k, v]) => ({ nodeId: k.startsWith("node.") ? k.split(".")[1] : undefined, message: v?.[0] ?? "" }));
      setServerIssues(issues.filter((i) => i.nodeId && !validation.errors.some((e) => e.nodeId === i.nodeId && e.message === i.message)));
      setIssuesOpen(true);
      return toast(r.error, "error");
    }
    setA(r.data.automation);
    toast(`Version ${r.data.automation.currentVersion} is live${r.data.automation.status === "active" ? "" : " (automation is inactive)"}`);
    if (r.data.warnings.length) toast(r.data.warnings[0].message, "error");
  }
  async function toggleStatus() {
    setBusy("status");
    const r = await apiFetch<{ automation: AutomationView }>(`${base}/status`, { method: "POST", body: { action: a.status === "active" ? "deactivate" : "activate" } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setA(r.data.automation);
    toast(r.data.automation.status === "active" ? "Automation activated" : "Automation deactivated");
  }
  async function restoreVersion(v: VersionRow) {
    remember();
    const r = await apiFetch<{ automation: AutomationView }>(`${base}/versions/${v.id}`, { method: "POST" });
    if (!r.ok) return toast(r.error, "error");
    const g = toRF(r.data.automation.graph);
    setNodes(g.nodes);
    setEdges(g.edges);
    setA(r.data.automation);
    setSaved(JSON.stringify({ g: toGraph(g.nodes, g.edges), meta }));
    setTab("builder");
    toast(`Version ${v.version} restored to the draft — publish to make it live`);
  }

  // Keyboard: undo / redo / save.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || tab !== "builder" || readOnly) return;
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]");
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      } else if (!typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!typing && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedFlow = selected ? (toGraph([selected], []).nodes[0] as FlowNode) : null;
  const status = AUTO_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
  const focusNode = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === id })));
    setSelectedId(id);
    setTab("builder");
    rf.setCenter(n.position.x + 124, n.position.y + 60, { zoom: 1, duration: 400 });
  };

  const webhookInfo = <WebhookTriggerInfo orgId={orgId} automationId={a.id} hasSecret={a.hasWebhookSecret} canManage={canManage} />;
  const inspector = selectedFlow ? (
    <NodeInspector key={selectedFlow.id} node={selectedFlow} onChange={(d) => updateNodeData(selectedFlow.id, d)} onDelete={() => deleteNode(selectedFlow.id)} lists={lists} readOnly={readOnly} webhook={webhookInfo} />
  ) : (
    <SettingsForm meta={meta} setMeta={setMeta} accounts={accounts} readOnly={readOnly} />
  );

  const TABS = [
    { id: "builder", label: "Builder", icon: Workflow },
    { id: "logs", label: "Logs", icon: ListChecks },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "versions", label: "Versions", icon: History },
  ];

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-4rem)] min-h-[560px] flex-col overflow-hidden sm:-mx-6 lg:-mx-8">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-app-border bg-app-surface px-3 py-2 sm:px-4">
        <Link href="/automations" className="rounded-lg p-1.5 text-app-muted hover:bg-app-hover hover:text-app-text" aria-label="Back to automations">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-body font-semibold text-app-text">{meta.name || a.name}</h1>
          <p className="flex flex-wrap items-center gap-1.5 text-caption text-app-subtle">
            <Badge tone={status.tone} dot>{status.label}</Badge>
            <span>{a.published ? `v${a.currentVersion} live` : "Not published"}</span>
            {dirty ? <span className="text-amber-300">· Unsaved changes</span> : null}
            <span className="hidden sm:inline">· {live ? "Live updates on" : "Offline"}</span>
          </p>
        </div>
        <nav aria-label="Automation sections" className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-small", tab === t.id ? "bg-app-primary-soft text-app-text" : "text-app-muted hover:bg-app-hover")}
            >
              <t.icon className="size-4" aria-hidden="true" /> {t.label}
            </button>
          ))}
        </nav>
        {canManage ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
              <FlaskConical aria-hidden="true" /> <span className="hidden md:inline">Test</span>
            </Button>
            {a.published ? (
              <Button size="sm" variant="secondary" onClick={toggleStatus} loading={busy === "status"}>
                {a.status === "active" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                <span className="hidden md:inline">{a.status === "active" ? "Deactivate" : "Activate"}</span>
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onSave} loading={busy === "save"} disabled={!dirty}>
              <Save aria-hidden="true" /> <span className="hidden md:inline">Save</span>
            </Button>
            <Button size="sm" onClick={() => setPublishOpen(true)} loading={busy === "publish"}>
              <Rocket aria-hidden="true" /> Publish
            </Button>
          </div>
        ) : null}
      </header>

      {tab === "builder" ? (
        <div className="flex min-h-0 flex-1">
          {/* Palette (desktop) */}
          {canManage && wide ? (
            <aside aria-label="Steps" className="app-scroll w-56 shrink-0 overflow-y-auto border-r border-app-border bg-app-surface p-3">
              <p className="mb-2 text-caption font-semibold uppercase tracking-wider text-app-subtle">Add a step</p>
              <p className="mb-3 text-caption text-app-subtle">Click to add after the selected step, or drag onto the canvas.</p>
              <ul className="space-y-1.5">
                {PALETTE.map((p) => {
                  const Icon = NODE_ICON[p.type];
                  return (
                    <li key={p.type}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/mecgura-node", p.type);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={() => addNode(p.type)}
                        className="flex w-full items-start gap-2.5 rounded-lg border border-app-border bg-app-elevated p-2 text-left hover:border-app-border-strong"
                      >
                        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", NODE_ACCENT[p.type].split(" ").filter((c) => !c.startsWith("border-l-")).join(" "))}>
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-small font-medium text-app-text">{NODE_LABELS[p.type]}</span>
                          <span className="block text-caption text-app-subtle">{p.hint}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          ) : null}

          {/* Canvas */}
          <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <BuilderContext.Provider value={info}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={isValidConnection}
                onNodeDragStart={() => remember()}
                onPaneClick={() => setSelectedId(null)}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                deleteKeyCode={readOnly ? null : ["Delete", "Backspace"]}
                colorMode="dark"
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={1.75}
                proOptions={{ hideAttribution: true }}
                aria-label="Automation canvas"
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-app-border-strong)" />
                <Controls showInteractive={false} position="bottom-left" />
                {wide ? <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === "condition" ? "#a78bfa" : n.type === "trigger" ? "#fbbf24" : n.type === "end" ? "#6d7a72" : "#10b981")} maskColor="rgba(9,13,11,0.7)" style={{ background: "var(--color-app-surface)" }} /> : null}
              </ReactFlow>
            </BuilderContext.Provider>

            {/* Floating toolbar */}
            <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1 rounded-xl border border-app-border bg-app-surface/95 p-1 shadow-lg">
              {canManage ? (
                <>
                  <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!hist.undo}>
                    <Undo2 aria-hidden="true" />
                  </IconButton>
                  <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!hist.redo}>
                    <Redo2 aria-hidden="true" />
                  </IconButton>
                  {!wide ? (
                    <Dropdown label="Add a step" align="start" trigger={<span className="flex h-8 items-center gap-1 px-2 text-small text-app-text"><Plus className="size-4" aria-hidden="true" /> Step <ChevronDown className="size-3" aria-hidden="true" /></span>}>
                      {(close) =>
                        PALETTE.map((p) => (
                          <DropdownItem key={p.type} onClick={() => { close(); addNode(p.type); }}>
                            {NODE_LABELS[p.type]}
                          </DropdownItem>
                        ))
                      }
                    </Dropdown>
                  ) : null}
                </>
              ) : null}
              {!wide ? (
                <IconButton label="Automation settings" onClick={() => setSettingsOpen(true)}>
                  <Settings2 aria-hidden="true" />
                </IconButton>
              ) : null}
              <button type="button" onClick={() => setShowStats((s) => !s)} aria-pressed={showStats} className={cn("rounded-lg px-2 py-1.5 text-caption", showStats ? "bg-app-primary-soft text-app-text" : "text-app-muted hover:bg-app-hover")}>
                <span className="sm:hidden">Stats</span>
                <span className="hidden sm:inline">Step stats</span>
              </button>
              <button
                type="button"
                onClick={() => setIssuesOpen((o) => !o)}
                className={cn("flex items-center gap-1 rounded-lg px-2 py-1.5 text-caption", allIssues.length ? "text-red-300 hover:bg-app-hover" : "text-emerald-300")}
                aria-expanded={issuesOpen}
              >
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {allIssues.length ? `${allIssues.length} to fix` : <>Ready<span className="hidden sm:inline">&nbsp;to publish</span></>}
              </button>
            </div>
            {issuesOpen && (allIssues.length || validation.warnings.length) ? (
              <div className="app-scroll absolute left-3 top-16 max-h-[50%] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-app-border bg-app-surface p-3 shadow-xl" role="region" aria-label="Problems">
                <ul className="space-y-2 text-small">
                  {allIssues.map((i, k) => (
                    <li key={`e${k}`}>
                      <button type="button" className="text-left text-red-300 hover:underline disabled:no-underline" disabled={!i.nodeId} onClick={() => i.nodeId && focusNode(i.nodeId)}>
                        {i.nodeId ? `${nodeTitle(toGraph(nodes.filter((n) => n.id === i.nodeId), []).nodes[0] ?? ({ type: "end", data: {} } as FlowNode))}: ` : ""}
                        {i.message}
                      </button>
                    </li>
                  ))}
                  {validation.warnings.map((w, k) => (
                    <li key={`w${k}`} className="text-amber-200">{w.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Inspector */}
          {wide ? (
            <aside aria-label={selectedFlow ? "Step settings" : "Automation settings"} className="app-scroll w-80 shrink-0 overflow-y-auto border-l border-app-border bg-app-surface p-4">
              <p className="mb-3 flex items-center gap-2 text-small font-semibold text-app-text">
                <Settings2 className="size-4" aria-hidden="true" /> {selectedFlow ? "Step settings" : "Automation settings"}
              </p>
              {inspector}
            </aside>
          ) : (
            <Drawer open={Boolean(selectedFlow)} onClose={() => setSelectedId(null)} title="Step settings" side="right">
              <DrawerHeader title="Step settings" onClose={() => setSelectedId(null)} />
              <div className="p-4">{inspector}</div>
            </Drawer>
          )}
        </div>
      ) : (
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          {tab === "logs" ? <LogsPanel orgId={orgId} automationId={a.id} canManage={canManage} refreshKey={refreshKey} onOpen={setExecId} /> : null}
          {tab === "analytics" ? <AnalyticsPanel orgId={orgId} automationId={a.id} refreshKey={refreshKey} labels={Object.fromEntries(graph.nodes.map((n) => [n.id, nodeTitle(n)]))} /> : null}
          {tab === "versions" ? <VersionsPanel versions={a.versions} canManage={canManage} onRestore={restoreVersion} /> : null}
        </div>
      )}

      <ExecutionDrawer orgId={orgId} executionId={execId} onClose={() => { setExecId(null); setActiveNodeId(null); }} canManage={canManage} refreshKey={refreshKey} onHighlight={setActiveNodeId} />
      <TestModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        orgId={orgId}
        automationId={a.id}
        beforeStart={async () => (dirty ? save() : true)}
        onStarted={(id) => {
          setTestOpen(false);
          setExecId(id);
          toast("Test started — follow it step by step");
        }}
      />
      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} onPublish={publish} busy={busy === "publish"} issues={validation.errors.length} version={a.currentVersion + 1} />
      {!wide ? (
        <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Automation settings" side="right">
          <DrawerHeader title="Automation settings" onClose={() => setSettingsOpen(false)} />
          <div className="p-4">
            <SettingsForm meta={meta} setMeta={setMeta} accounts={accounts} readOnly={readOnly} />
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

function SettingsForm({ meta, setMeta, accounts, readOnly }: { meta: Meta; setMeta: React.Dispatch<React.SetStateAction<Meta>>; accounts: Account[]; readOnly: boolean }) {
  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <p className="text-caption text-app-muted">Select a step on the canvas to edit it.</p>
      <Field id="as-name" label="Name">
        <Input value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} maxLength={120} />
      </Field>
      <Field id="as-desc" label="Description">
        <Textarea value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} rows={3} maxLength={500} />
      </Field>
      <Field id="as-acct" label="Send from" hint="Replies use the number the customer wrote to; this number is used otherwise.">
        <Select value={meta.whatsappAccountId} onChange={(e) => setMeta((m) => ({ ...m, whatsappAccountId: e.target.value }))}>
          <option value="">First connected number</option>
          {accounts.map((x) => (
            <option key={x.id} value={x.id}>{x.displayName} · {x.phoneNumber}{x.isDemo ? " (demo)" : ""}</option>
          ))}
        </Select>
      </Field>
      <Field id="as-reentry" label="Can a contact go through it again?">
        <Select value={meta.reentry} onChange={(e) => setMeta((m) => ({ ...m, reentry: e.target.value as Meta["reentry"] }))}>
          <option value="always">Yes, each time it&apos;s triggered (one run at a time)</option>
          <option value="once">No, only once per contact</option>
        </Select>
      </Field>
      <Alert tone="info" title="Built-in safety">
        No loops (flows must end), max 100 steps per run, automations can trigger each other only 3 levels deep, retries are limited to 3, and opted-out or suppressed contacts are never messaged.
      </Alert>
    </fieldset>
  );
}

function PublishModal({ open, onClose, onPublish, busy, issues, version }: { open: boolean; onClose: () => void; onPublish: (note: string) => void; busy: boolean; issues: number; version: number }) {
  const [note, setNote] = React.useState("");
  return (
    <Modal open={open} onClose={onClose} title={`Publish version ${version}`} description="New runs use this version immediately. Runs already in progress finish on the version they started with.">
      <div className="space-y-4">
        {issues ? <Alert tone="danger">{issues} problem(s) must be fixed first — publishing will show them on the canvas.</Alert> : null}
        <Field id="pub-note" label="What changed? (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Shorter welcome message" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onPublish(note)} loading={busy}>
            <Rocket aria-hidden="true" /> Publish
          </Button>
        </div>
      </div>
    </Modal>
  );
}
