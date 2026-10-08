"use client";
import { MoreHorizontal, Eye, Pencil, Palette, Users, Globe, ToggleRight, ScrollText } from "lucide-react";
import { Dropdown } from "@/components/ui";

/** Row menu on the clinics list: navigation only. Dangerous actions (suspend, archive …) live on the clinic page, behind a confirmation. */
export function ClinicRowActions({ id, name }: { id: string; name: string; status?: string }) {
  const icon = (I: typeof Eye) => <I aria-hidden className="size-4" />;
  return (
    <Dropdown triggerLabel={`Actions for ${name}`} triggerClassName="flex size-control items-center justify-center rounded-md hover:bg-surface-muted" trigger={<MoreHorizontal aria-hidden className="size-5" />}
      items={[
        { label: "Open", href: `/platform/clinics/${id}`, icon: icon(Eye) },
        { label: "Edit profile", href: `/platform/clinics/${id}/edit`, icon: icon(Pencil) },
        { label: "Users", href: `/platform/clinics/${id}/users`, icon: icon(Users) },
        { label: "Branding", href: `/platform/clinics/${id}/branding`, icon: icon(Palette) },
        { label: "Domains", href: `/platform/clinics/${id}/domains`, icon: icon(Globe) },
        { label: "Features", href: `/platform/clinics/${id}/features`, icon: icon(ToggleRight) },
        { label: "Audit", href: `/platform/clinics/${id}/audit`, icon: icon(ScrollText) },
      ]} />
  );
}
