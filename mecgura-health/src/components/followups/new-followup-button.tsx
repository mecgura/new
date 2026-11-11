"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { NewFollowUpModal } from "./new-followup-modal";

export function NewFollowUpButton({ canClinical }: { canClinical: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}><Plus aria-hidden className="size-4" />New follow-up</Button><NewFollowUpModal open={open} onClose={() => setOpen(false)} canClinical={canClinical} onCreated={(id) => router.push(`/followups/${id}`)} /></>;
}
