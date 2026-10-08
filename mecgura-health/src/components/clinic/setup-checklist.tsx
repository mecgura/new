import Link from "next/link";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { Card, CardBody, CardHeader, Progress } from "@/components/ui";

interface Item { key: string; label: string; done: boolean; href: string; hint: string }

export function SetupChecklist({ items, later }: { items: Item[]; later: string[] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <Card>
      <CardHeader title="Clinic setup" description="Finish these to get your workspace ready." />
      <CardBody className="space-y-4">
        <Progress label="Setup progress" value={done} max={items.length} />
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 py-2.5">
              {i.done ? <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" /> : <Circle aria-hidden className="size-5 shrink-0 text-muted" />}
              <span className="type-body min-w-0 flex-1">{i.label}<span className="sr-only">{i.done ? " — done" : " — not done"}</span></span>
              {!i.done && <Link href={i.href} className="type-caption !text-primary shrink-0 font-semibold">{i.hint}</Link>}
            </li>
          ))}
          {later.map((l) => (
            <li key={l} className="flex items-center gap-3 py-2.5 opacity-70">
              <Clock aria-hidden className="size-5 shrink-0 text-muted" />
              <span className="type-body min-w-0 flex-1">{l}<span className="sr-only"> — not available yet</span></span>
              <span className="type-caption shrink-0">Coming later</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
