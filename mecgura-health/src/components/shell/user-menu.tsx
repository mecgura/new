"use client";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";
import { Avatar, Dropdown } from "@/components/ui";
import { logoutAction } from "@/app/actions/auth";

export function UserMenu({ name, email, roleLabel, avatarUrl }: { name: string; email: string; roleLabel: string; avatarUrl?: string | null }) {
  return (
    <Dropdown
      triggerLabel={`Account menu for ${name}`}
      triggerClassName="flex min-h-control items-center gap-2 rounded-lg px-1.5 hover:bg-surface-muted"
      trigger={<>
        <Avatar name={name} src={avatarUrl} size="sm" />
        <span className="hidden text-left leading-tight lg:block"><span className="block max-w-36 truncate text-sm font-semibold">{name}</span><span className="type-caption block">{roleLabel}</span></span>
        <ChevronDown aria-hidden className="hidden size-4 text-muted lg:block" />
      </>}
      items={[
        { type: "label", label: email },
        { label: "Profile & workspace", href: "/settings", icon: <UserRound aria-hidden className="size-4" /> },
        { label: "Settings", href: "/settings", icon: <Settings aria-hidden className="size-4" /> },
        { type: "separator" },
        { label: "Sign out", tone: "danger", icon: <LogOut aria-hidden className="size-4" />, onSelect: () => { void logoutAction(); } },
      ]}
    />
  );
}
