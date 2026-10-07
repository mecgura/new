"use client";

import * as React from "react";
import { MessageSquareDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, Badge, EmptyState, ErrorState, LoadingState, SearchBar, Select } from "@/components/ds";
import { shortTime, type Account, type Conversation } from "@/components/inbox/types";

export type ListFilters = { tab: "all" | "unread" | "assigned" | "mine"; q: string; status: "open" | "closed" | "all"; accountId: string };

const TABS: { id: ListFilters["tab"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "assigned", label: "Assigned" },
  { id: "mine", label: "Mine" },
];

export function ConversationList({
  items,
  counts,
  loading,
  error,
  onRetry,
  filters,
  onFilters,
  selectedId,
  onSelect,
  accounts,
  footer,
}: {
  items: Conversation[] | null;
  counts: Record<string, number>;
  loading: boolean;
  error: string;
  onRetry: () => void;
  filters: ListFilters;
  onFilters: (f: ListFilters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  accounts: Account[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-app-border p-3">
        <div role="tablist" aria-label="Conversation filter" className="grid grid-cols-4 gap-1 rounded-[var(--radius-control)] bg-app-bg p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={filters.tab === t.id}
              onClick={() => onFilters({ ...filters, tab: t.id })}
              className={cn(
                "rounded-md px-1 py-1.5 text-caption font-medium transition-colors",
                filters.tab === t.id ? "bg-app-elevated text-app-text shadow-sm" : "text-app-muted hover:text-app-text"
              )}
            >
              {t.label}
              <span className="ml-1 tabular-nums text-app-subtle">{counts[t.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <SearchBar label="Search conversations" placeholder="Search name, phone or message…" value={filters.q} onChange={(e) => onFilters({ ...filters, q: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Status filter" value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value as ListFilters["status"] })} className="h-9 text-small">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All statuses</option>
          </Select>
          <Select aria-label="Number filter" value={filters.accountId} onChange={(e) => onFilters({ ...filters, accountId: e.target.value })} className="h-9 text-small">
            <option value="">All numbers</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {error ? (
          <ErrorState description={error} onRetry={onRetry} />
        ) : items === null ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState icon={MessageSquareDashed} title="No conversations" description={filters.q ? "Nothing matches your search." : "New WhatsApp messages will appear here."} />
        ) : (
          <ul aria-label="Conversations">
            {items.map((c) => {
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-app-border px-3 py-3 text-left transition-colors",
                      active ? "bg-app-primary-soft" : "hover:bg-app-hover/60"
                    )}
                  >
                    <Avatar name={c.contact.name || c.contact.phone} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-body", c.unreadCount ? "font-semibold text-app-text" : "text-app-text")}>{c.contact.name || c.contact.phone}</span>
                        <time className="shrink-0 text-caption text-app-subtle" dateTime={c.lastMessageAt}>
                          {shortTime(c.lastMessageAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={cn("truncate text-small", c.unreadCount ? "text-app-text" : "text-app-muted")}>{c.lastMessagePreview || "No messages yet"}</span>
                        {c.unreadCount ? (
                          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-app-primary px-1.5 text-caption font-bold text-app-on-primary">
                            {c.unreadCount}
                            <span className="sr-only"> unread</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {c.assignedTo ? <Badge>{c.assignedTo.name}</Badge> : <Badge tone="warning">Unassigned</Badge>}
                        {c.isDemo ? <Badge tone="info">Demo</Badge> : null}
                        {c.status === "closed" ? <Badge>Closed</Badge> : null}
                        {c.contact.tags.slice(0, 2).map((t) => (
                          <Badge key={t.id} tone="primary">
                            {t.name}
                          </Badge>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footer}
    </div>
  );
}
