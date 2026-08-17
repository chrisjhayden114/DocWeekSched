import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { KebabMenu } from "../KebabMenu";
import { ListEmpty, ListError, ListSkeleton } from "../ListState";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
import { Select } from "../Select";
import { StatusChip } from "../StatusChip";
import { SlideOver } from "../kit";
import { formatRelativeTime } from "../../lib/dateFormat";
import { API_URL } from "../../lib/api";
import { organizerFetch } from "../../lib/organizerApi";
import {
  buildSubjectRows,
  chipForStatus,
  filterRows,
  isLate,
  isOpenStatus,
  isReadinessFilePreviewable,
  needsAttention,
  subjectKey,
  summaryCounts,
  READINESS_OFFICE_DOWNLOAD_NOTE,
  READINESS_REQUIREMENT_KINDS,
  READINESS_STATUS_LABELS,
  REQUIREMENT_KIND_HELPERS,
  REQUIREMENT_KIND_LABELS,
  type OverviewAssignment,
  type OverviewRequirement,
  type OverviewTemplate,
  type ReadinessOverview,
  type ReadinessRequirementKind,
  type ReadinessStatus,
  type ReadinessStatusFilter,
} from "../../lib/readinessView";

/**
 * ER3a+b — the organizer Readiness tab (EVENT_READINESS_PLAN §15 ER3):
 * templates + requirements CRUD, assignment to this event's speakers and
 * sessions, the per-subject readiness table, the exception-first overview,
 * safe sequential bulk actions, and the activity history over the ER2 API.
 *
 * All reads come from GET /readiness/overview (plus GET /readiness/activity
 * for the history disclosure); every write refetches (status changes update
 * optimistically first). LATE is server-derived — this component never
 * recomputes deadlines. Bulk actions deliberately loop the existing
 * per-assignment PATCH so every change stays individually audited.
 */

type Props = {
  eventId: string;
  speakers: { id: string; name: string; title?: string | null; affiliation?: string | null }[];
  sessions: { id: string; title: string }[];
};

type TemplateEditorState = { templateId: string | null };

type RequirementDraft = {
  /** null = adding a new requirement. */
  id: string | null;
  label: string;
  kind: ReadinessRequirementKind;
  helpText: string;
  required: boolean;
  /** datetime-local value ("" = no due date). */
  dueAt: string;
};

type ConfirmState =
  | { kind: "delete-template"; template: OverviewTemplate }
  | { kind: "delete-requirement"; requirement: OverviewRequirement }
  | { kind: "waive"; assignment: OverviewAssignment }
  | { kind: "unwaive"; assignment: OverviewAssignment }
  | { kind: "bulk-waive"; count: number }
  | { kind: "reject"; assignment: OverviewAssignment; submissionId: string };

type PortalAccessRow = {
  id: string;
  speakerId: string;
  email: string;
  invitedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type ActivityEntry = { at: string; actorName: string; summary: string };

/** The needs-attention card shows this many rows until "Show all". */
const ATTENTION_PREVIEW = 8;

/** ISO → datetime-local input value, in the organizer's local time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value → ISO (null when cleared/invalid). */
function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatDue(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Derived-late marker: red dot, due date in the tooltip. */
function LateDot({ dueAt }: { dueAt: string | null }) {
  const due = formatDue(dueAt);
  const text = due ? `Late — was due ${due}` : "Late";
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      style={{
        width: 8,
        height: 8,
        borderRadius: "var(--radius-pill)",
        background: "var(--danger)",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

const KIND_OPTIONS = READINESS_REQUIREMENT_KINDS.map((kind) => ({
  value: kind,
  label: REQUIREMENT_KIND_LABELS[kind],
}));

/** WAIVED is reachable only through the confirm-gated Waive action. */
const STATUS_SELECT_OPTIONS = (
  ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "READY", "NOT_APPLICABLE"] as const
).map((status) => ({ value: status, label: READINESS_STATUS_LABELS[status] }));

const STATUS_FILTER_OPTIONS: { value: ReadinessStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "late", label: "Late" },
  { value: "ready", label: "Ready" },
];

const emptyRequirementDraft = (): RequirementDraft => ({
  id: null,
  label: "",
  kind: "short_text",
  helpText: "",
  required: true,
  dueAt: "",
});

export function ReadinessTab({ eventId, speakers, sessions }: Props) {
  const [overview, setOverview] = useState<ReadinessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Inline error line for main-panel actions (never alert()). */
  const [actionError, setActionError] = useState<string | null>(null);

  // Template SlideOver editor
  const [editor, setEditor] = useState<TemplateEditorState | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplDescription, setTplDescription] = useState("");
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);
  const [reqDraft, setReqDraft] = useState<RequirementDraft | null>(null);
  const [reqBusy, setReqBusy] = useState(false);

  // Assign SlideOver
  const [assignFor, setAssignFor] = useState<OverviewTemplate | null>(null);
  const [selSpeakerIds, setSelSpeakerIds] = useState<string[]>([]);
  const [selSessionIds, setSelSessionIds] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<{ created: number; skipped: number } | null>(
    null,
  );

  // Subject detail SlideOver
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dueDrafts, setDueDrafts] = useState<Record<string, string>>({});
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Shared confirm
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Readiness table filters (client-side)
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReadinessStatusFilter>("all");

  // ER3b — exception-first overview
  const [attentionExpanded, setAttentionExpanded] = useState(false);

  // ER3b — bulk selection (subject keys) + sequential runner state
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // ER3b — activity disclosure (loaded on first open, refreshed on demand)
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // ER3b — template-evolution backfill hint (set after adding a requirement
  // to a template that already has assigned subjects)
  const [backfillForId, setBackfillForId] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<number | null>(null);

  // ER4 — presenter portal (speaker subjects only)
  const [portalAccesses, setPortalAccesses] = useState<PortalAccessRow[]>([]);
  const [portalEmail, setPortalEmail] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [mintedUrl, setMintedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    const [data, portal] = await Promise.all([
      organizerFetch<ReadinessOverview>("/readiness/overview", eventId),
      organizerFetch<{ accesses: PortalAccessRow[] }>("/readiness/portal-access", eventId).catch(
        () => ({ accesses: [] as PortalAccessRow[] }),
      ),
    ]);
    setOverview(data);
    setPortalAccesses(portal.accesses);
  }, [eventId]);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    load()
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load readiness"))
      .finally(() => setLoading(false));
  }, [load]);

  /** Post-write refetch; failures land on the inline action error line. */
  const refetch = useCallback(async () => {
    try {
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to refresh readiness");
    }
  }, [load]);

  const rows = useMemo(() => (overview ? buildSubjectRows(overview) : []), [overview]);
  const visibleRows = useMemo(
    () => filterRows(rows, query, statusFilter),
    [rows, query, statusFilter],
  );

  // ER3b — everything below derives client-side from the overview payload.
  const counts = useMemo(() => summaryCounts(rows), [rows]);
  const attention = useMemo(() => needsAttention(rows), [rows]);
  /** OPEN assignments of the selected subjects — ready/waived never touched. */
  const selectedOpenAssignments = useMemo(() => {
    const out: OverviewAssignment[] = [];
    for (const row of rows) {
      if (!selectedKeys.has(row.key)) continue;
      for (const a of row.assignments) if (isOpenStatus(a.status)) out.push(a);
    }
    return out;
  }, [rows, selectedKeys]);

  // After a refetch, drop subjects that no longer have open work so a
  // half-finished bulk run doesn't leave settled rows checked.
  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const row of rows) {
        if (prev.has(row.key) && row.rollup.open > 0) next.add(row.key);
      }
      if (next.size === prev.size && [...next].every((k) => prev.has(k))) return prev;
      return next;
    });
  }, [rows]);

  /** templateId → distinct subjects assigned from it (for "Assigned" column). */
  const assignedCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const a of overview?.assignments ?? []) {
      const set = counts.get(a.templateId) ?? new Set<string>();
      set.add(subjectKey(a.subject));
      counts.set(a.templateId, set);
    }
    return counts;
  }, [overview]);

  const editingTemplate = useMemo(
    () =>
      editor?.templateId != null
        ? (overview?.templates.find((t) => t.id === editor.templateId) ?? null)
        : null,
    [editor, overview],
  );
  const editingAssignedCount = editingTemplate
    ? (assignedCounts.get(editingTemplate.id)?.size ?? 0)
    : 0;

  const detailRow = useMemo(
    () => (detailKey ? (rows.find((r) => r.key === detailKey) ?? null) : null),
    [detailKey, rows],
  );

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  function openTemplateEditor(template: OverviewTemplate | null) {
    setEditor({ templateId: template?.id ?? null });
    setTplName(template?.name ?? "");
    setTplDescription(template?.description ?? "");
    setTplError(null);
    setReqDraft(null);
    setBackfillForId(null);
    setBackfillResult(null);
  }

  function closeTemplateEditor() {
    setEditor(null);
    setReqDraft(null);
    setTplError(null);
    setBackfillForId(null);
    setBackfillResult(null);
  }

  async function saveTemplate() {
    if (!tplName.trim()) return;
    setTplBusy(true);
    setTplError(null);
    try {
      const body = JSON.stringify({
        name: tplName.trim(),
        description: tplDescription.trim() || null,
      });
      if (editingTemplate) {
        await organizerFetch(`/readiness/templates/${editingTemplate.id}`, eventId, {
          method: "PATCH",
          body,
        });
        await load();
      } else {
        const created = await organizerFetch<{ id: string }>("/readiness/templates", eventId, {
          method: "POST",
          body,
        });
        await load();
        // Stay in the editor, now on the created template, so requirements
        // can be added right away.
        setEditor({ templateId: created.id });
      }
    } catch (err) {
      setTplError(err instanceof Error ? err.message : "Could not save template");
    } finally {
      setTplBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Requirements (inside the template editor)
  // -------------------------------------------------------------------------

  function startEditRequirement(requirement: OverviewRequirement) {
    setReqDraft({
      id: requirement.id,
      label: requirement.label,
      kind: READINESS_REQUIREMENT_KINDS.includes(requirement.kind as ReadinessRequirementKind)
        ? (requirement.kind as ReadinessRequirementKind)
        : "short_text",
      helpText: requirement.helpText ?? "",
      required: requirement.required,
      dueAt: toLocalInput(requirement.dueAt),
    });
    setTplError(null);
  }

  async function saveRequirement() {
    if (!editingTemplate || !reqDraft || !reqDraft.label.trim()) return;
    setReqBusy(true);
    setTplError(null);
    try {
      const payload = {
        label: reqDraft.label.trim(),
        kind: reqDraft.kind,
        helpText: reqDraft.helpText.trim() || null,
        required: reqDraft.required,
        dueAt: fromLocalInput(reqDraft.dueAt),
        // Omit config on edit so API maxBytes/allowedMimeTypes overrides survive.
        // New file requirements get {}; validation defaults to the deck rule.
        ...(reqDraft.id ? {} : { config: {} }),
      };
      if (reqDraft.id) {
        await organizerFetch(`/readiness/requirements/${reqDraft.id}`, eventId, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const last = editingTemplate.requirements[editingTemplate.requirements.length - 1];
        await organizerFetch(`/readiness/templates/${editingTemplate.id}/requirements`, eventId, {
          method: "POST",
          body: JSON.stringify({ ...payload, sortOrder: (last?.sortOrder ?? -1) + 1 }),
        });
        // ER3b — template-evolution safety: subjects assigned before this
        // requirement existed have no tracked row for it yet. Offer the
        // backfill (the assign endpoint's skip-existing semantics create
        // exactly the missing rows).
        if ((assignedCounts.get(editingTemplate.id)?.size ?? 0) > 0) {
          setBackfillForId(editingTemplate.id);
          setBackfillResult(null);
        }
      }
      await load();
      setReqDraft(null);
    } catch (err) {
      setTplError(err instanceof Error ? err.message : "Could not save requirement");
    } finally {
      setReqBusy(false);
    }
  }

  /**
   * Swap with the neighbor, then renumber to index order — handles legacy
   * rows that share a sortOrder (where a plain value swap would be a no-op).
   */
  async function moveRequirement(index: number, delta: -1 | 1) {
    if (!editingTemplate) return;
    const reqs = editingTemplate.requirements;
    const target = index + delta;
    if (target < 0 || target >= reqs.length) return;
    const ordered = reqs.slice();
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setReqBusy(true);
    setTplError(null);
    try {
      for (let i = 0; i < ordered.length; i += 1) {
        if (ordered[i].sortOrder !== i) {
          await organizerFetch(`/readiness/requirements/${ordered[i].id}`, eventId, {
            method: "PATCH",
            body: JSON.stringify({ sortOrder: i }),
          });
        }
      }
      await load();
    } catch (err) {
      setTplError(err instanceof Error ? err.message : "Could not reorder requirements");
    } finally {
      setReqBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Assign
  // -------------------------------------------------------------------------

  function openAssign(template: OverviewTemplate) {
    setAssignFor(template);
    setSelSpeakerIds([]);
    setSelSessionIds([]);
    setAssignError(null);
    setAssignResult(null);
  }

  async function submitAssign() {
    if (!assignFor || selSpeakerIds.length + selSessionIds.length === 0) return;
    setAssignBusy(true);
    setAssignError(null);
    setAssignResult(null);
    try {
      const result = await organizerFetch<{ created: number; skipped: number }>(
        `/readiness/templates/${assignFor.id}/assign`,
        eventId,
        {
          method: "POST",
          body: JSON.stringify({ speakerIds: selSpeakerIds, sessionIds: selSessionIds }),
        },
      );
      setAssignResult(result);
      setSelSpeakerIds([]);
      setSelSessionIds([]);
      await refetch();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Could not assign template");
    } finally {
      setAssignBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Backfill a new requirement to a template's already-assigned subjects
  // (ER3b — template-evolution safety). POSTs the template's existing subject
  // ids to /assign; skip-existing semantics create exactly the missing rows.
  // -------------------------------------------------------------------------

  async function backfillAssigned(template: OverviewTemplate) {
    const speakerIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const a of overview?.assignments ?? []) {
      if (a.templateId !== template.id) continue;
      if (a.subject.type === "speaker") speakerIds.add(a.subject.id);
      else sessionIds.add(a.subject.id);
    }
    if (speakerIds.size + sessionIds.size === 0) return;
    setBackfillBusy(true);
    setTplError(null);
    try {
      const result = await organizerFetch<{ created: number; skipped: number }>(
        `/readiness/templates/${template.id}/assign`,
        eventId,
        {
          method: "POST",
          body: JSON.stringify({
            speakerIds: [...speakerIds],
            sessionIds: [...sessionIds],
          }),
        },
      );
      setBackfillResult(result.created);
      await refetch();
    } catch (err) {
      setTplError(
        err instanceof Error ? err.message : "Could not add the requirement to assigned subjects",
      );
    } finally {
      setBackfillBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Bulk actions (ER3b) — sequential loop over the EXISTING per-assignment
  // PATCH, so every change stays individually audited. Stops on the first
  // error with an honest message; nothing after the failure is touched.
  // -------------------------------------------------------------------------

  function toggleRowSelection(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setBulkError(null);
  }

  function clearSelection() {
    setSelectedKeys(new Set());
    setBulkError(null);
  }

  async function runBulk(status: "READY" | "WAIVED") {
    const targets = selectedOpenAssignments;
    if (targets.length === 0 || bulkProgress != null) return;
    setBulkError(null);
    let done = 0;
    try {
      for (const target of targets) {
        setBulkProgress({ done: done + 1, total: targets.length });
        await organizerFetch(`/readiness/assignments/${target.id}`, eventId, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        done += 1;
      }
      setSelectedKeys(new Set());
    } catch (err) {
      const failed = targets[done];
      const message = err instanceof Error ? err.message : "Update failed";
      setBulkError(
        `Stopped at item ${done + 1} of ${targets.length} (“${failed.requirementLabel}” for ${
          failed.subject.name
        }): ${message}. The first ${done} change${done === 1 ? "" : "s"} went through; nothing after was touched.`,
      );
    } finally {
      setBulkProgress(null);
      await refetch();
    }
  }

  // -------------------------------------------------------------------------
  // Activity history (ER3b) — loaded when the disclosure first opens;
  // Refresh refetches. No polling.
  // -------------------------------------------------------------------------

  const loadActivity = useCallback(async () => {
    setActivityBusy(true);
    setActivityError(null);
    try {
      const data = await organizerFetch<{ entries: ActivityEntry[] }>(
        "/readiness/activity",
        eventId,
      );
      setActivity(data.entries);
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setActivityBusy(false);
    }
  }, [eventId]);

  /** Shared by the table's Details button and the needs-attention Open. */
  function openSubjectDetail(key: string) {
    setDetailKey(key);
    setDetailError(null);
    setDueDrafts({});
    setMintedUrl(null);
    setCopied(false);
    const speakerId = key.startsWith("speaker:") ? key.slice("speaker:".length) : "";
    const existing = portalAccesses.find((p) => p.speakerId === speakerId);
    setPortalEmail(existing?.email ?? "");
  }

  function portalForSpeaker(speakerId: string): PortalAccessRow | undefined {
    return portalAccesses.find((p) => p.speakerId === speakerId);
  }

  async function mintPortal(speakerId: string) {
    if (!portalEmail.trim()) return;
    setPortalBusy(true);
    setDetailError(null);
    try {
      const result = await organizerFetch<{
        url: string;
        access: PortalAccessRow;
        email: { delivered: boolean; copyUrl?: string; fallbackMessage?: string };
      }>("/readiness/portal-access", eventId, {
        method: "POST",
        body: JSON.stringify({ speakerId, email: portalEmail.trim() }),
      });
      setMintedUrl(result.url);
      setPortalAccesses((prev) => {
        const rest = prev.filter((p) => p.speakerId !== speakerId);
        return [...rest, result.access];
      });
      if (!result.email.delivered && result.email.fallbackMessage) {
        setDetailError(result.email.fallbackMessage);
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not send the portal invite");
    } finally {
      setPortalBusy(false);
    }
  }

  async function remintPortal(accessId: string) {
    setPortalBusy(true);
    setDetailError(null);
    try {
      const result = await organizerFetch<{ url: string; access: PortalAccessRow }>(
        `/readiness/portal-access/${accessId}/remint`,
        eventId,
        { method: "POST" },
      );
      setMintedUrl(result.url);
      setPortalAccesses((prev) => prev.map((p) => (p.id === accessId ? result.access : p)));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not reissue the portal link");
    } finally {
      setPortalBusy(false);
    }
  }

  async function revokePortal(accessId: string) {
    setPortalBusy(true);
    setDetailError(null);
    try {
      const access = await organizerFetch<PortalAccessRow>(
        `/readiness/portal-access/${accessId}/revoke`,
        eventId,
        { method: "POST" },
      );
      setMintedUrl(null);
      setPortalAccesses((prev) => prev.map((p) => (p.id === accessId ? access : p)));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not revoke the portal link");
    } finally {
      setPortalBusy(false);
    }
  }

  async function reviewSubmission(submissionId: string, action: "approve" | "reject", reason?: string) {
    setRowBusyId(submissionId);
    setDetailError(null);
    try {
      await organizerFetch(`/readiness/submissions/${submissionId}`, eventId, {
        method: "PATCH",
        body: JSON.stringify(action === "reject" ? { action, reason } : { action }),
      });
      await load();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not review the submission");
    } finally {
      setRowBusyId(null);
    }
  }

  function copyMintedUrl() {
    if (!mintedUrl) return;
    void navigator.clipboard.writeText(mintedUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  // -------------------------------------------------------------------------
  // Assignment updates (detail SlideOver)
  // -------------------------------------------------------------------------

  async function patchAssignment(assignmentId: string, body: Record<string, unknown>) {
    setRowBusyId(assignmentId);
    setDetailError(null);
    try {
      await organizerFetch(`/readiness/assignments/${assignmentId}`, eventId, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Could not update assignment");
      await refetch();
    } finally {
      setRowBusyId(null);
    }
  }

  function setStatus(assignment: OverviewAssignment, next: ReadinessStatus) {
    if (next === assignment.status) return;
    // Optimistic: the chip flips immediately; the refetch inside
    // patchAssignment reconciles derived state (late, rollups).
    setOverview((prev) =>
      prev
        ? {
            ...prev,
            assignments: prev.assignments.map((a) =>
              a.id === assignment.id ? { ...a, status: next } : a,
            ),
          }
        : prev,
    );
    void patchAssignment(assignment.id, { status: next });
  }

  // -------------------------------------------------------------------------
  // Confirmed actions
  // -------------------------------------------------------------------------

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "delete-template") {
        await organizerFetch(`/readiness/templates/${confirm.template.id}`, eventId, {
          method: "DELETE",
        });
        if (editor?.templateId === confirm.template.id) closeTemplateEditor();
        if (assignFor?.id === confirm.template.id) setAssignFor(null);
        setConfirm(null);
        await refetch();
      } else if (confirm.kind === "delete-requirement") {
        await organizerFetch(`/readiness/requirements/${confirm.requirement.id}`, eventId, {
          method: "DELETE",
        });
        setConfirm(null);
        await refetch();
      } else if (confirm.kind === "bulk-waive") {
        setConfirm(null);
        // runBulk reports its own progress/error inline in the action bar.
        await runBulk("WAIVED");
      } else if (confirm.kind === "reject") {
        const reason = rejectReason.trim();
        setConfirm(null);
        setRejectReason("");
        await reviewSubmission(confirm.submissionId, "reject", reason);
      } else {
        const status: ReadinessStatus = confirm.kind === "waive" ? "WAIVED" : "NOT_STARTED";
        setConfirm(null);
        await patchAssignment(confirm.assignment.id, { status });
      }
    } catch (err) {
      setConfirm(null);
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setConfirmBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading && !overview) return <ListSkeleton rows={4} />;
  if (loadError && !overview) {
    return (
      <ListError
        message={loadError}
        onRetry={() => {
          setLoading(true);
          setLoadError(null);
          load()
            .catch((err) =>
              setLoadError(err instanceof Error ? err.message : "Failed to load readiness"),
            )
            .finally(() => setLoading(false));
        }}
      />
    );
  }
  if (!overview) return null;

  const templates = overview.templates;
  const deleteTemplateTracked =
    confirm?.kind === "delete-template"
      ? overview.assignments.filter((a) => a.templateId === confirm.template.id).length
      : 0;
  const deleteRequirementTracked =
    confirm?.kind === "delete-requirement"
      ? overview.assignments.filter((a) => a.requirementId === confirm.requirement.id).length
      : 0;
  const speakerOptions = speakers.map((s) => ({
    id: s.id,
    name: s.name,
    role: [s.title, s.affiliation].filter(Boolean).join(", ") || undefined,
  }));
  const sessionOptions = sessions.map((s) => ({ id: s.id, name: s.title }));

  const requirementForm =
    reqDraft != null ? (
      <div
        style={{
          border: "1px solid var(--gray-300)",
          borderRadius: "var(--radius-sm)",
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <label style={{ margin: 0 }}>
          Label
          <input
            className="input"
            required
            placeholder="e.g. Bio, Headshot, Slides"
            value={reqDraft.label}
            onChange={(e) => setReqDraft({ ...reqDraft, label: e.target.value })}
          />
        </label>
        <label style={{ margin: 0 }} htmlFor="readiness-req-kind">
          Kind
          <Select
            id="readiness-req-kind"
            options={KIND_OPTIONS}
            value={reqDraft.kind}
            onChange={(v) => setReqDraft({ ...reqDraft, kind: v as ReadinessRequirementKind })}
          />
          {REQUIREMENT_KIND_HELPERS[reqDraft.kind] ? (
            <span className="help-text" style={{ display: "block", marginTop: 4 }}>
              {REQUIREMENT_KIND_HELPERS[reqDraft.kind]}
            </span>
          ) : null}
        </label>
        <label style={{ margin: 0 }}>
          Help text <span className="text-meta">(optional)</span>
          <input
            className="input"
            placeholder="Shown next to the requirement"
            value={reqDraft.helpText}
            onChange={(e) => setReqDraft({ ...reqDraft, helpText: e.target.value })}
          />
        </label>
        <label
          style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}
        >
          <input
            type="checkbox"
            checked={reqDraft.required}
            onChange={(e) => setReqDraft({ ...reqDraft, required: e.target.checked })}
          />
          Required
        </label>
        {reqDraft.kind === "file" ? (
          <p className="help-text" style={{ margin: 0 }}>
            PDF, PowerPoint, Word, or image — up to 20 MB — or paste a link (Google
            Slides, Canva, etc.).
          </p>
        ) : null}
        <label style={{ margin: 0 }}>
          Due date <span className="text-meta">(optional)</span>
          <input
            className="input"
            type="datetime-local"
            value={reqDraft.dueAt}
            onChange={(e) => setReqDraft({ ...reqDraft, dueAt: e.target.value })}
          />
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button secondary"
            disabled={reqBusy}
            onClick={() => setReqDraft(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            disabled={reqBusy || !reqDraft.label.trim()}
            onClick={() => void saveRequirement()}
          >
            {reqBusy ? "Saving…" : reqDraft.id ? "Save requirement" : "Add requirement"}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      {actionError ? (
        <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
          {actionError}
        </p>
      ) : null}

      {templates.length === 0 ? (
        // The activation moment — no templates yet.
        <div className="console-panel">
          <ListEmpty
            title="Collect what you need from speakers and sessions"
            body="Start with a template: a named set of requirements (bio, headshot, slides, AV needs…) you assign to people or sessions."
            actionLabel="Create your first template"
            onAction={() => openTemplateEditor(null)}
          />
        </div>
      ) : (
        <>
          {/* ——— ER3b: exception-first overview (derived client-side) ——— */}
          {rows.length > 0 ? (
            <div className="console-panel">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chip">
                  {counts.subjects} subject{counts.subjects === 1 ? "" : "s"}
                </span>
                <span className="chip">{counts.complete} complete</span>
                <span className="chip">{counts.open} open</span>
                <span
                  className="chip"
                  style={counts.late > 0 ? { color: "var(--danger)" } : undefined}
                >
                  {counts.late} late
                </span>
              </div>
              <p className="console-panel-label" style={{ margin: "12px 0 8px" }}>
                Needs attention
              </p>
              {attention.length === 0 ? (
                <p className="help-text" style={{ margin: 0 }}>
                  All caught up — nothing needs your attention.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <ul
                    style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}
                  >
                    {(attentionExpanded ? attention : attention.slice(0, ATTENTION_PREVIEW)).map(
                      (a) => {
                        const chip = chipForStatus(a.status);
                        const due = formatDue(a.effectiveDueAt);
                        return (
                          <li
                            key={a.id}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                gap: 8,
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <strong>{a.subject.name}</strong>
                              <span>{a.requirementLabel}</span>
                              <StatusChip status={chip.chipStatus} label={chip.label} />
                              {isLate(a) ? <LateDot dueAt={a.effectiveDueAt} /> : null}
                              <span className="text-meta">
                                {due ? `due ${due}` : "no due date"}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="button secondary"
                              style={{ minHeight: 44 }}
                              onClick={() => openSubjectDetail(subjectKey(a.subject))}
                            >
                              Open
                            </button>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  {attention.length > ATTENTION_PREVIEW ? (
                    <button
                      type="button"
                      className="button ghost"
                      style={{ minHeight: 44, justifySelf: "start" }}
                      onClick={() => setAttentionExpanded((v) => !v)}
                    >
                      {attentionExpanded
                        ? "Show fewer"
                        : `Show all (${attention.length})`}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div className="console-panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <p className="console-panel-label" style={{ margin: 0 }}>
                Templates
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => openTemplateEditor(null)}
              >
                New template
              </button>
            </div>
            <p className="help-text">
              A template is a named set of requirements. Assign it to speakers or sessions to
              start tracking them below.
            </p>
            {/* overflow:visible so the row kebab panel isn't clipped by
                console-table-wrap's overflow-x:auto (CSS pairs that to
                overflow-y:auto) — live-observed: Edit was unreachable on
                short template lists. */}
            <div className="console-table-wrap" style={{ overflow: "visible" }}>
              <table className="console-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Requirements</th>
                    <th>Assigned</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.name}
                        {t.description ? (
                          <span className="text-meta"> — {t.description}</span>
                        ) : null}
                      </td>
                      <td>{t.requirements.length}</td>
                      <td>
                        {(() => {
                          const n = assignedCounts.get(t.id)?.size ?? 0;
                          return n === 1 ? "1 subject" : `${n} subjects`;
                        })()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => openAssign(t)}
                          >
                            Assign…
                          </button>
                          <KebabMenu
                            label={`Actions for ${t.name}`}
                            items={[
                              {
                                id: "edit",
                                label: "Edit template",
                                onSelect: () => openTemplateEditor(t),
                              },
                              {
                                id: "assign",
                                label: "Assign…",
                                onSelect: () => openAssign(t),
                              },
                              {
                                id: "delete",
                                label: "Delete template",
                                tone: "danger",
                                onSelect: () => setConfirm({ kind: "delete-template", template: t }),
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="console-panel">
            <p className="console-panel-label">Readiness</p>
            {rows.length === 0 ? (
              <p className="help-text" style={{ margin: 0 }}>
                No assignments yet — press Assign… on a template to start tracking speakers or
                sessions.
              </p>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <input
                    className="input"
                    type="search"
                    placeholder="Filter by name"
                    aria-label="Filter subjects by name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ maxWidth: 280 }}
                  />
                  <Select
                    aria-label="Filter by status"
                    options={STATUS_FILTER_OPTIONS}
                    value={statusFilter}
                    onChange={(v) => setStatusFilter(v as ReadinessStatusFilter)}
                    style={{ minWidth: 130 }}
                  />
                </div>
                {selectedKeys.size > 0 ? (
                  <div
                    role="toolbar"
                    aria-label="Bulk readiness actions"
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                      padding: "8px 12px",
                      marginBottom: 12,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--gray-200)",
                      background: "var(--gray-50)",
                    }}
                  >
                    <span style={{ font: "var(--text-label)", color: "var(--gray-900)" }}>
                      {selectedOpenAssignments.length} selected
                    </span>
                    {bulkProgress ? (
                      <span className="text-meta" aria-live="polite">
                        Updating {bulkProgress.done} of {bulkProgress.total}…
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="button"
                      style={{ minHeight: 44 }}
                      disabled={
                        selectedOpenAssignments.length === 0 || bulkProgress != null
                      }
                      onClick={() => void runBulk("READY")}
                    >
                      Mark READY
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ minHeight: 44 }}
                      disabled={
                        selectedOpenAssignments.length === 0 || bulkProgress != null
                      }
                      onClick={() =>
                        setConfirm({
                          kind: "bulk-waive",
                          count: selectedOpenAssignments.length,
                        })
                      }
                    >
                      Waive…
                    </button>
                    <button
                      type="button"
                      className="button ghost"
                      style={{ minHeight: 44 }}
                      disabled={bulkProgress != null}
                      onClick={clearSelection}
                    >
                      Clear selection
                    </button>
                    {bulkError ? (
                      <p role="alert" style={{ color: "var(--danger)", margin: 0, flexBasis: "100%" }}>
                        {bulkError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {visibleRows.length === 0 ? (
                  <p className="help-text" style={{ margin: 0 }}>
                    No speakers or sessions match this filter.
                  </p>
                ) : (
                  <div className="console-table-wrap">
                    <table className="console-table">
                      <thead>
                        <tr>
                          <th aria-label="Select" style={{ width: 44 }} />
                          <th>Speaker / session</th>
                          <th>Requirements</th>
                          <th>Ready</th>
                          <th aria-label="Details" />
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  minHeight: 44,
                                  minWidth: 44,
                                  margin: 0,
                                  cursor: row.rollup.open > 0 ? "pointer" : "default",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedKeys.has(row.key)}
                                  disabled={row.rollup.open === 0 || bulkProgress != null}
                                  aria-label={`Select open requirements for ${row.name}`}
                                  onChange={() => toggleRowSelection(row.key)}
                                />
                              </label>
                            </td>
                            <td>
                              <span
                                style={{
                                  display: "inline-flex",
                                  gap: 8,
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                {row.name}
                                <StatusChip
                                  status="default"
                                  label={row.type === "speaker" ? "Speaker" : "Session"}
                                />
                              </span>
                            </td>
                            <td>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  alignItems: "center",
                                }}
                              >
                                {row.assignments.map((a) => {
                                  const chip = chipForStatus(a.status);
                                  const due = formatDue(a.effectiveDueAt);
                                  const tooltip = `${a.requirementLabel} — ${chip.label}${
                                    due ? ` · due ${due}` : ""
                                  }`;
                                  return (
                                    <span
                                      key={a.id}
                                      title={tooltip}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <StatusChip
                                        status={chip.chipStatus}
                                        label={a.requirementLabel}
                                      />
                                      {isLate(a) ? <LateDot dueAt={a.effectiveDueAt} /> : null}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {row.rollup.ready}/{row.rollup.total} ready
                              {row.rollup.late > 0 ? (
                                <span style={{ color: "var(--danger)" }}>
                                  {" "}
                                  · {row.rollup.late} late
                                </span>
                              ) : null}
                              {row.rollup.waived > 0 ? (
                                <span className="text-meta"> · {row.rollup.waived} waived</span>
                              ) : null}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                className="button secondary"
                                style={{ minHeight: 44 }}
                                onClick={() => openSubjectDetail(row.key)}
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ——— ER3b: activity history (AuditLog; load on open, refresh on demand) ——— */}
      <details
        className="console-panel"
        onToggle={(e) => {
          if (e.currentTarget.open && activity === null && !activityBusy) void loadActivity();
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
          }}
        >
          Activity
        </summary>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <button
            type="button"
            className="button secondary"
            style={{ justifySelf: "start", minHeight: 44 }}
            disabled={activityBusy}
            onClick={() => void loadActivity()}
          >
            {activityBusy ? "Refreshing…" : "Refresh"}
          </button>
          {activityError ? (
            <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
              {activityError}
            </p>
          ) : null}
          {activityBusy && activity === null ? (
            <p className="help-text" style={{ margin: 0 }}>
              Loading activity…
            </p>
          ) : null}
          {activity && activity.length === 0 ? (
            <p className="help-text" style={{ margin: 0 }}>
              No activity yet.
            </p>
          ) : null}
          {activity && activity.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {activity.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="text-meta">
                  {formatRelativeTime(entry.at)} · {entry.actorName} — {entry.summary}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      {/* ——— Template editor SlideOver (name/description + requirements) ——— */}
      <SlideOver
        open={editor != null}
        wide
        title={editingTemplate ? "Edit template" : "New template"}
        onClose={closeTemplateEditor}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="button secondary" onClick={closeTemplateEditor}>
              Close
            </button>
            <button
              type="button"
              className="button"
              disabled={tplBusy || !tplName.trim()}
              onClick={() => void saveTemplate()}
            >
              {tplBusy ? "Saving…" : editingTemplate ? "Save changes" : "Create template"}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          {tplError ? (
            <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
              {tplError}
            </p>
          ) : null}
          <label style={{ margin: 0 }}>
            Name
            <input
              className="input"
              required
              placeholder="e.g. Keynote speaker"
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
            />
          </label>
          <label style={{ margin: 0 }}>
            Description <span className="text-meta">(optional)</span>
            <textarea
              className="input"
              rows={2}
              placeholder="What this template collects and who it's for"
              value={tplDescription}
              onChange={(e) => setTplDescription(e.target.value)}
            />
          </label>

          {editingTemplate ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p className="console-panel-label" style={{ margin: "8px 0 0" }}>
                Requirements
              </p>
              {editingTemplate.requirements.length === 0 && reqDraft == null ? (
                <p className="help-text" style={{ margin: 0 }}>
                  No requirements yet — add the items you need from each speaker or session.
                </p>
              ) : null}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {editingTemplate.requirements.map((r, i) =>
                  reqDraft?.id === r.id ? (
                    <li key={r.id}>{requirementForm}</li>
                  ) : (
                    <li
                      key={r.id}
                      style={{
                        border: "1px solid var(--gray-200)",
                        borderRadius: "var(--radius-sm)",
                        padding: "8px 10px",
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <div>
                          {r.label}
                          {r.required ? null : <span className="text-meta"> — optional</span>}
                        </div>
                        <div className="text-meta">
                          {REQUIREMENT_KIND_LABELS[r.kind as ReadinessRequirementKind] ?? r.kind}
                          {r.dueAt ? ` · due ${formatDue(r.dueAt)}` : ""}
                        </div>
                        {r.helpText ? <div className="text-meta">{r.helpText}</div> : null}
                      </div>
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button
                          type="button"
                          className="button ghost"
                          aria-label={`Move ${r.label} up`}
                          disabled={i === 0 || reqBusy}
                          style={{ minHeight: 44, minWidth: 44, padding: "8px 10px" }}
                          onClick={() => void moveRequirement(i, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="button ghost"
                          aria-label={`Move ${r.label} down`}
                          disabled={i === editingTemplate.requirements.length - 1 || reqBusy}
                          style={{ minHeight: 44, minWidth: 44, padding: "8px 10px" }}
                          onClick={() => void moveRequirement(i, 1)}
                        >
                          ↓
                        </button>
                        <KebabMenu
                          label={`Actions for ${r.label}`}
                          items={[
                            {
                              id: "edit",
                              label: "Edit",
                              onSelect: () => startEditRequirement(r),
                            },
                            {
                              id: "delete",
                              label: "Delete",
                              tone: "danger",
                              onSelect: () =>
                                setConfirm({ kind: "delete-requirement", requirement: r }),
                            },
                          ]}
                        />
                      </div>
                    </li>
                  ),
                )}
              </ul>
              {reqDraft != null && reqDraft.id == null ? requirementForm : null}
              {reqDraft == null ? (
                <button
                  type="button"
                  className="button secondary"
                  style={{ justifySelf: "start" }}
                  onClick={() => setReqDraft(emptyRequirementDraft())}
                >
                  Add requirement
                </button>
              ) : null}
              {backfillForId === editingTemplate.id ? (
                <div
                  style={{
                    border: "1px solid var(--gray-200)",
                    borderRadius: "var(--radius-sm)",
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {backfillResult != null ? (
                    <p role="status" style={{ color: "var(--success)", margin: 0 }}>
                      Created {backfillResult} assignment{backfillResult === 1 ? "" : "s"}.
                    </p>
                  ) : (
                    <>
                      <p className="help-text" style={{ margin: 0 }}>
                        This template is assigned to {editingAssignedCount} subject
                        {editingAssignedCount === 1 ? "" : "s"} — the new requirement isn't tracked
                        for them yet.
                      </p>
                      <button
                        type="button"
                        className="button secondary"
                        style={{ justifySelf: "start", minHeight: 44 }}
                        disabled={backfillBusy}
                        onClick={() => void backfillAssigned(editingTemplate)}
                      >
                        {backfillBusy
                          ? "Adding…"
                          : `Add to ${editingAssignedCount} assigned subject${
                              editingAssignedCount === 1 ? "" : "s"
                            }`}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="help-text" style={{ margin: 0 }}>
              Create the template first — you can add its requirements right after.
            </p>
          )}
        </div>
      </SlideOver>

      {/* ——— Assign SlideOver ——— */}
      <SlideOver
        open={assignFor != null}
        wide
        title={assignFor ? `Assign “${assignFor.name}”` : "Assign"}
        onClose={() => setAssignFor(null)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="button secondary" onClick={() => setAssignFor(null)}>
              Close
            </button>
            <button
              type="button"
              className="button"
              disabled={assignBusy || selSpeakerIds.length + selSessionIds.length === 0}
              onClick={() => void submitAssign()}
            >
              {assignBusy
                ? "Assigning…"
                : `Assign to ${selSpeakerIds.length + selSessionIds.length || "…"}`}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          <p className="help-text" style={{ margin: 0 }}>
            Creates one tracked item per requirement for each selected speaker or session.
            Anything already assigned is skipped, so re-assigning is safe.
          </p>
          {assignFor && assignFor.requirements.length === 0 ? (
            <p role="alert" style={{ color: "var(--warning)", margin: 0 }}>
              This template has no requirements yet — assigning it creates nothing. Add
              requirements first.
            </p>
          ) : null}
          <SearchableMultiSelect
            label="Speakers"
            people={speakerOptions}
            selectedIds={selSpeakerIds}
            onChange={setSelSpeakerIds}
            placeholder="Search speakers…"
            emptyLabel="No speakers in this event yet"
            selectAllNoun="speakers"
          />
          <SearchableMultiSelect
            label="Sessions"
            people={sessionOptions}
            selectedIds={selSessionIds}
            onChange={setSelSessionIds}
            placeholder="Search sessions…"
            emptyLabel="No sessions in this event yet"
            selectAllNoun="sessions"
          />
          {assignError ? (
            <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
              {assignError}
            </p>
          ) : null}
          {assignResult ? (
            <p role="status" style={{ color: "var(--success)", margin: 0 }}>
              Created {assignResult.created} assignment{assignResult.created === 1 ? "" : "s"}
              {assignResult.skipped > 0
                ? ` · ${assignResult.skipped} already existed and ${
                    assignResult.skipped === 1 ? "was" : "were"
                  } skipped`
                : ""}
              .
            </p>
          ) : null}
        </div>
      </SlideOver>

      {/* ——— Subject detail SlideOver (per-assignment actions) ——— */}
      <SlideOver
        open={detailRow != null}
        wide
        title={detailRow?.name ?? "Details"}
        onClose={() => setDetailKey(null)}
      >
        {detailRow ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="text-meta" style={{ margin: 0 }}>
              {detailRow.type === "speaker" ? "Speaker" : "Session"} ·{" "}
              {detailRow.rollup.ready}/{detailRow.rollup.total} ready
              {detailRow.rollup.late > 0 ? ` · ${detailRow.rollup.late} late` : ""}
            </p>
            {detailError ? (
              <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>
                {detailError}
              </p>
            ) : null}
            {detailRow.type === "speaker" ? (
              <div
                style={{
                  border: "1px solid var(--gray-200)",
                  borderRadius: "var(--radius-sm)",
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <p className="console-panel-label" style={{ margin: 0 }}>
                  Presenter portal
                </p>
                {(() => {
                  const access = portalForSpeaker(detailRow.id);
                  const expired = access
                    ? new Date(access.expiresAt).getTime() < Date.now()
                    : false;
                  return (
                    <>
                      <label style={{ margin: 0 }}>
                        Presenter email
                        <input
                          className="input"
                          type="email"
                          autoComplete="email"
                          placeholder="speaker@university.edu"
                          value={portalEmail}
                          disabled={portalBusy}
                          onChange={(e) => setPortalEmail(e.target.value)}
                        />
                      </label>
                      {access ? (
                        <p className="text-meta" style={{ margin: 0 }}>
                          Invited {formatDue(access.invitedAt) ?? "—"}
                          {access.expiresAt ? ` · expires ${formatDue(access.expiresAt)}` : ""}
                          {access.lastUsedAt ? ` · last used ${formatDue(access.lastUsedAt)}` : ""}
                          {access.revokedAt
                            ? ` · revoked ${formatDue(access.revokedAt)}`
                            : expired
                              ? " · expired"
                              : ""}
                        </p>
                      ) : (
                        <p className="help-text" style={{ margin: 0 }}>
                          Sends a 30-day link. The presenter never creates an account.
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="button"
                          disabled={portalBusy || !portalEmail.trim()}
                          onClick={() =>
                            access
                              ? void remintPortal(access.id)
                              : void mintPortal(detailRow.id)
                          }
                        >
                          {portalBusy
                            ? "Working…"
                            : access
                              ? "Resend portal invite"
                              : "Send portal invite"}
                        </button>
                        {access && !access.revokedAt ? (
                          <button
                            type="button"
                            className="button secondary"
                            disabled={portalBusy}
                            onClick={() => void revokePortal(access.id)}
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                      {mintedUrl ? (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <input
                            className="input"
                            readOnly
                            value={mintedUrl}
                            aria-label="Portal URL (shown once)"
                            style={{ flex: "1 1 200px" }}
                          />
                          <button
                            type="button"
                            className="button secondary"
                            onClick={copyMintedUrl}
                          >
                            {copied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            ) : null}
            {detailRow.assignments.map((a) => {
              const chip = chipForStatus(a.status);
              const busy = rowBusyId === a.id;
              const draft = dueDrafts[a.id] ?? toLocalInput(a.dueAtOverride);
              const draftChanged = draft !== toLocalInput(a.dueAtOverride);
              const filePreviewable = a.latestSubmission?.fileName
                ? isReadinessFilePreviewable(
                    a.latestSubmission.fileMime,
                    a.latestSubmission.fileName,
                  )
                : false;
              return (
                <div
                  key={a.id}
                  style={{
                    border: "1px solid var(--gray-200)",
                    borderRadius: "var(--radius-sm)",
                    padding: 12,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{a.requirementLabel}</strong>
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <StatusChip status={chip.chipStatus} label={chip.label} />
                      {isLate(a) ? <LateDot dueAt={a.effectiveDueAt} /> : null}
                    </span>
                  </div>
                  {a.effectiveDueAt || a.waivedAt ? (
                    <p className="text-meta" style={{ margin: 0 }}>
                      {a.effectiveDueAt
                        ? `Due ${formatDue(a.effectiveDueAt)}${a.dueAtOverride ? " (override)" : ""}`
                        : null}
                      {a.effectiveDueAt && a.waivedAt ? " · " : null}
                      {a.waivedAt ? `Waived ${formatDue(a.waivedAt)}` : null}
                    </p>
                  ) : null}
                  {a.latestSubmission ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <p className="text-meta" style={{ margin: 0 }}>
                        Latest submission
                        {a.latestSubmission.submittedAt
                          ? ` · ${formatDue(a.latestSubmission.submittedAt)}`
                          : ""}
                        {a.latestSubmission.approvedAt ? " · approved" : ""}
                        {a.latestSubmission.rejectedAt ? " · rejected" : ""}
                      </p>
                      {a.latestSubmission.fileName ? (
                        <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
                          <a
                            className="button secondary"
                            href={`${API_URL}/readiness/files/${a.latestSubmission.id}?eventId=${encodeURIComponent(eventId)}`}
                            target="_blank"
                            rel="noreferrer"
                            title={filePreviewable ? undefined : READINESS_OFFICE_DOWNLOAD_NOTE}
                            style={{ justifySelf: "start", minHeight: 44 }}
                          >
                            {filePreviewable ? "Preview" : "Download"} {a.latestSubmission.fileName}
                          </a>
                          {!filePreviewable ? (
                            <p className="text-meta" style={{ margin: 0 }}>
                              {READINESS_OFFICE_DOWNLOAD_NOTE}
                            </p>
                          ) : null}
                        </div>
                      ) : isHttpUrl(a.latestSubmission.value) ? (
                        <a
                          href={a.latestSubmission.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ justifySelf: "start", overflowWrap: "anywhere" }}
                        >
                          {a.latestSubmission.value}
                        </a>
                      ) : a.latestSubmission.value != null ? (
                        <p style={{ margin: 0, overflowWrap: "anywhere" }}>
                          {typeof a.latestSubmission.value === "string"
                            ? a.latestSubmission.value
                            : JSON.stringify(a.latestSubmission.value)}
                        </p>
                      ) : null}
                      {a.latestSubmission.rejectedReason ? (
                        <p className="text-meta" style={{ margin: 0, color: "var(--danger)" }}>
                          {a.latestSubmission.rejectedReason}
                        </p>
                      ) : null}
                      {!a.latestSubmission.approvedAt ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="button"
                            disabled={busy || rowBusyId === a.latestSubmission.id}
                            onClick={() => void reviewSubmission(a.latestSubmission!.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy || rowBusyId === a.latestSubmission.id}
                            onClick={() => {
                              setRejectReason("");
                              setConfirm({
                                kind: "reject",
                                assignment: a,
                                submissionId: a.latestSubmission!.id,
                              });
                            }}
                          >
                            Reject…
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <label style={{ margin: 0 }} htmlFor={`readiness-status-${a.id}`}>
                    Status
                    <Select
                      id={`readiness-status-${a.id}`}
                      options={STATUS_SELECT_OPTIONS}
                      value={a.status === "WAIVED" ? "" : a.status}
                      placeholder="Waived"
                      disabled={busy || a.status === "WAIVED"}
                      onChange={(v) => setStatus(a, v as ReadinessStatus)}
                    />
                  </label>
                  <label style={{ margin: 0 }}>
                    Due date override
                    <input
                      className="input"
                      type="datetime-local"
                      value={draft}
                      disabled={busy}
                      onChange={(e) => setDueDrafts({ ...dueDrafts, [a.id]: e.target.value })}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy || !draftChanged}
                      onClick={() =>
                        void patchAssignment(a.id, { dueAtOverride: fromLocalInput(draft) }).then(
                          () =>
                            setDueDrafts((prev) => {
                              const next = { ...prev };
                              delete next[a.id];
                              return next;
                            }),
                        )
                      }
                    >
                      Apply due date
                    </button>
                    {a.dueAtOverride ? (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          void patchAssignment(a.id, { dueAtOverride: null }).then(() =>
                            setDueDrafts((prev) => {
                              const next = { ...prev };
                              delete next[a.id];
                              return next;
                            }),
                          )
                        }
                      >
                        Clear override
                      </button>
                    ) : null}
                    {a.status === "WAIVED" ? (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "unwaive", assignment: a })}
                      >
                        Un-waive
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "waive", assignment: a })}
                      >
                        Waive
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </SlideOver>

      {/* ——— One shared confirm for every destructive/audited action ——— */}
      <ConfirmDialog
        open={confirm != null}
        title={
          confirm?.kind === "delete-template"
            ? `Delete “${confirm.template.name}”?`
            : confirm?.kind === "delete-requirement"
              ? `Delete “${confirm.requirement.label}”?`
              : confirm?.kind === "waive"
                ? `Waive “${confirm.assignment.requirementLabel}”?`
                : confirm?.kind === "unwaive"
                  ? `Un-waive “${confirm.assignment.requirementLabel}”?`
                  : confirm?.kind === "bulk-waive"
                    ? `Waive ${confirm.count} requirement${confirm.count === 1 ? "" : "s"}?`
                    : confirm?.kind === "reject"
                      ? `Reject “${confirm.assignment.requirementLabel}”?`
                      : ""
        }
        body={
          confirm?.kind === "delete-template"
            ? `Deletes the template, its ${confirm.template.requirements.length} requirement${
                confirm.template.requirements.length === 1 ? "" : "s"
              }, and all ${deleteTemplateTracked} tracked assignment${
                deleteTemplateTracked === 1 ? "" : "s"
              } including progress and waivers. This can't be undone.`
            : confirm?.kind === "delete-requirement"
              ? `Deleting removes this requirement AND its ${deleteRequirementTracked} tracked item${
                  deleteRequirementTracked === 1 ? "" : "s"
                }, including any progress or waivers. This can't be undone.`
              : confirm?.kind === "waive"
                ? `Waiving records who and when — visible in the activity history. ${confirm.assignment.subject.name} won't be chased for this item.`
                : confirm?.kind === "unwaive"
                  ? `Un-waiving is recorded the same way — who and when, visible in the activity history. The item returns to Not started.`
                  : confirm?.kind === "bulk-waive"
                    ? `Waive ${confirm.count} requirement${confirm.count === 1 ? "" : "s"}? Each waive is recorded individually.`
                    : confirm?.kind === "reject"
                      ? "The presenter will see this reason and can resubmit."
                      : ""
        }
        confirmLabel={
          confirm?.kind === "delete-template" || confirm?.kind === "delete-requirement"
            ? "Delete"
            : confirm?.kind === "waive" || confirm?.kind === "bulk-waive"
              ? "Waive"
              : confirm?.kind === "reject"
                ? "Reject"
                : "Un-waive"
        }
        tone={
          confirm?.kind === "delete-template" ||
          confirm?.kind === "delete-requirement" ||
          confirm?.kind === "reject"
            ? "danger"
            : "default"
        }
        busy={confirmBusy}
        promptLabel={confirm?.kind === "reject" ? "Reason" : undefined}
        promptValue={confirm?.kind === "reject" ? rejectReason : undefined}
        promptRequired={confirm?.kind === "reject"}
        promptPlaceholder="What should they change?"
        onPromptChange={confirm?.kind === "reject" ? setRejectReason : undefined}
        onCancel={() => {
          setConfirm(null);
          setRejectReason("");
        }}
        onConfirm={runConfirm}
      />
    </section>
  );
}
