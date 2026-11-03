"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ImagePlus, LineChart, MapPin, Sparkles, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { cn } from "@/lib/utils";
import { MarketingOverview } from "@/components/admin/marketing/overview-tab";
import { LeadsTab } from "@/components/admin/marketing/leads-tab";
import { CalendarTab } from "@/components/admin/marketing/calendar-tab";
import { CreativeMaker } from "@/components/admin/marketing/creative-maker";
import { AiStudio } from "@/components/admin/marketing/ai-studio";
import { OutreachTab } from "@/components/admin/marketing/outreach-tab";

const TABS = [
  { id: "overview", label: "Overview", icon: LineChart },
  { id: "leads", label: "Leads", icon: UsersRound },
  { id: "outreach", label: "Outreach", icon: MapPin },
  { id: "calendar", label: "Content calendar", icon: CalendarDays },
  { id: "ai", label: "AI studio", icon: Sparkles },
  { id: "creatives", label: "Creative maker", icon: ImagePlus },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AdminMarketingPage() {
  return (
    <React.Suspense fallback={null}>
      <MarketingPage />
    </React.Suspense>
  );
}

function MarketingPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const requested = sp.get("tab");
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : "overview";
  const go = (id: TabId) => router.replace(`/admin/marketing?tab=${id}`, { scroll: false });
  return (
    <>
      <PageHeader title="Marketing" description="MECGURA's own growth: where visitors come from, every lead and who to call today, the content plan, AI images and ad copy, and ready-to-post creatives." breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Marketing" }]} />
      <nav aria-label="Marketing sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </nav>
      {tab === "overview" ? <MarketingOverview onOpenLeads={() => go("leads")} /> : null}
      {tab === "leads" ? <LeadsTab initialLeadId={sp.get("lead")} /> : null}
      {tab === "outreach" ? <OutreachTab /> : null}
      {tab === "calendar" ? <CalendarTab /> : null}
      {tab === "ai" ? <AiStudio /> : null}
      {tab === "creatives" ? <CreativeMaker key={sp.get("img") ?? "none"} imageId={sp.get("img")} /> : null}
    </>
  );
}
