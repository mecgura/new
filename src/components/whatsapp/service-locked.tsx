import { Lock } from "lucide-react";
import { Card, EmptyState } from "@/components/ds";

/** Shown instead of a module the admin hasn't enabled for this workspace. */
export function ServiceLocked({ name }: { name: string }) {
  return (
    <Card>
      <EmptyState icon={Lock} title={`${name} isn't enabled`} description="This module isn't switched on for your workspace yet. Contact MECGURA to turn it on." />
    </Card>
  );
}
