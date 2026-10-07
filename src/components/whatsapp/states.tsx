import { Building2, Lock, MessageCircle } from "lucide-react";
import { Card, EmptyState } from "@/components/ds";

export function NoWorkspace() {
  return (
    <Card>
      <EmptyState icon={Building2} title="No workspace selected" description="You're not part of an active workspace." />
    </Card>
  );
}

export function ServiceDisabled() {
  return (
    <Card>
      <EmptyState
        icon={MessageCircle}
        title="WhatsApp Automation isn't enabled"
        description="This service hasn't been enabled for your workspace yet. Contact MECGURA to turn it on."
      />
    </Card>
  );
}

export function OwnerOnly({ what = "connect or change WhatsApp numbers" }: { what?: string }) {
  return (
    <Card>
      <EmptyState icon={Lock} title="Owner access required" description={`Only the workspace owner can ${what}.`} />
    </Card>
  );
}
