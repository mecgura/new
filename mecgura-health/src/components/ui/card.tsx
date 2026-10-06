import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...rest} />;
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line p-card", className)}>
      <div className="min-w-0">
        <h2 className="type-card-title">{title}</h2>
        {description && <p className="type-secondary mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-card", className)} {...rest} />;
}
