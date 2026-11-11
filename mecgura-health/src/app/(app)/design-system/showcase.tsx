"use client";
import { useState } from "react";
import { Settings, Trash2, UserRound } from "lucide-react";
import {
  Alert, Avatar, Badge, Breadcrumb, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DataTable, DatePicker, Drawer,
  Dropdown, EmailInput, EmptyState, ErrorState, Field, FileUpload, LoadingState, Modal, MultiSelect, NumberInput, Pagination,
  PasswordInput, PhoneInput, Progress, RadioGroup, SearchInput, Select, Skeleton, StatusBadge, Tabs, TextInput, Textarea,
  TimePicker, Toggle, Tooltip, useToast, type Column,
} from "@/components/ui";

const SWATCHES = [
  ["Primary", "bg-primary"], ["Primary soft", "bg-primary-soft"], ["Secondary", "bg-secondary"], ["Accent", "bg-accent"],
  ["Success", "bg-success"], ["Warning", "bg-warning"], ["Danger", "bg-danger"], ["Emergency", "bg-emergency"], ["Info", "bg-info"],
  ["Ink", "bg-ink"], ["Muted", "bg-muted"], ["Line", "bg-line"], ["Surface muted", "bg-surface-muted"],
] as const;

interface Row { id: string; name: string; status: React.ReactNode; note: string }
const ROWS: Row[] = [
  { id: "1", name: "Sample item A", status: <StatusBadge tone="success">Completed</StatusBadge>, note: "Demo row" },
  { id: "2", name: "Sample item B", status: <StatusBadge tone="warning">Waiting</StatusBadge>, note: "Demo row" },
  { id: "3", name: "Sample item C", status: <StatusBadge tone="emergency">Emergency</StatusBadge>, note: "Demo row" },
];
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name },
  { key: "status", header: "Status", cell: (r) => r.status },
  { key: "note", header: "Note", cell: (r) => r.note, hideOnMobile: true },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

export function Showcase() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [multi, setMulti] = useState<string[]>(["a"]);
  const [on, setOn] = useState(true);
  const [page, setPage] = useState(2);

  return (
    <div className="space-y-section">
      <div>
        <Breadcrumb items={[{ label: "Settings", href: "/settings" }, { label: "Design system" }]} />
        <h1 className="type-page-title">Design system</h1>
        <p className="type-secondary mt-1">Reference for every token and component. Future phases must reuse these — no ad-hoc styling.</p>
      </div>

      <Section title="Typography">
        <p className="type-page-title">Page title</p>
        <p className="type-section">Section heading</p>
        <p className="type-card-title">Card heading</p>
        <p className="type-body">Body text — the quick brown fox jumps over the lazy dog.</p>
        <p className="type-secondary">Secondary text</p>
        <p className="type-caption">Caption text</p>
        <p className="type-label">Label text</p>
        <p className="type-button">Button text</p>
        <p className="type-table">Table text</p>
        <p className="type-form">Form text</p>
      </Section>

      <Section title="Colours">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {SWATCHES.map(([name, cls]) => (
            <div key={name}><div className={`h-12 rounded-lg border border-line ${cls}`} /><p className="type-caption mt-1">{name}</p></div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="success">Success</Button>
          <Button loading>Loading</Button><Button disabled>Disabled</Button><Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Form inputs">
        <div className="grid gap-form md:grid-cols-2">
          <Field label="Text" hint="Helper text"><TextInput placeholder="Text" /></Field>
          <Field label="Email"><EmailInput placeholder="name@clinic.com" /></Field>
          <Field label="Phone"><PhoneInput /></Field>
          <Field label="Number"><NumberInput placeholder="0" /></Field>
          <Field label="Password"><PasswordInput /></Field>
          <Field label="Search"><SearchInput placeholder="Search…" /></Field>
          <Field label="Date"><DatePicker /></Field>
          <Field label="Time"><TimePicker /></Field>
          <Field label="Select"><Select placeholder="Choose…" options={[{ value: "1", label: "Option 1" }, { value: "2", label: "Option 2" }]} /></Field>
          <MultiSelect label="Multi-select" value={multi} onChange={setMulti} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }]} />
          <Field label="With error" error="This field is required." required><TextInput /></Field>
          <Field label="Textarea" className="md:col-span-2"><Textarea placeholder="Longer text…" /></Field>
        </div>
        <div className="grid gap-form md:grid-cols-3">
          <Checkbox label="Checkbox" description="With description" />
          <RadioGroup legend="Radio group" name="demo-radio" defaultValue="x" options={[{ value: "x", label: "Choice X" }, { value: "y", label: "Choice Y" }]} />
          <Toggle label="Toggle" checked={on} onChange={setOn} />
        </div>
        <FileUpload label="Choose files" accept=".pdf,image/*" multiple />
      </Section>

      <Section title="Badges & status">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge><Badge tone="primary">Primary</Badge>
          <StatusBadge tone="success">Completed</StatusBadge><StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="info">In consultation</StatusBadge><StatusBadge tone="danger">Failed</StatusBadge>
          <StatusBadge tone="emergency">Emergency</StatusBadge>
        </div>
        <div className="flex items-center gap-3"><Avatar name="Demo User" size="sm" /><Avatar name="Demo User" /><Avatar name="Demo User" size="lg" /></div>
        <Progress label="Setup progress" value={60} />
      </Section>

      <Section title="Alerts & toasts">
        <Alert tone="info" title="Information">This is an informational message.</Alert>
        <Alert tone="success" title="Success">The operation completed.</Alert>
        <Alert tone="warning" title="Warning">Check this before continuing.</Alert>
        <Alert tone="danger" title="Error">Something needs your attention.</Alert>
        <Alert tone="emergency" title="Emergency">Urgent — uses icon, text and colour.</Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast({ tone: "success", title: "Saved", description: "Toast example." })}>Success toast</Button>
          <Button variant="outline" onClick={() => toast({ tone: "danger", title: "Couldn't save", description: "Toast example." })}>Error toast</Button>
        </div>
      </Section>

      <Section title="Overlays & menus">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setModal(true)}>Open modal</Button>
          <Button variant="outline" onClick={() => setDrawer(true)}>Open drawer</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}><Trash2 aria-hidden className="size-4" />Confirm dialog</Button>
          <Dropdown triggerLabel="Example menu" triggerClassName="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4" trigger={<>Menu</>}
            items={[{ label: "Profile", icon: <UserRound aria-hidden className="size-4" />, onSelect: () => toast({ tone: "info", title: "Profile selected" }) }, { label: "Settings", href: "/settings", icon: <Settings aria-hidden className="size-4" /> }, { type: "separator" }, { label: "Delete", tone: "danger", icon: <Trash2 aria-hidden className="size-4" /> }]} />
          <Tooltip text="Tooltip text"><Button variant="ghost">Hover or focus me</Button></Tooltip>
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Example modal" description="Esc, backdrop click and the close button all dismiss it." footer={<Button onClick={() => setModal(false)}>Done</Button>}>
          <p className="type-body">Focus is trapped inside while open and restored afterwards.</p>
        </Modal>
        <Drawer open={drawer} onClose={() => setDrawer(false)} title="Example drawer"><p className="type-body">Drawer content.</p></Drawer>
        <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} onConfirm={() => setConfirm(false)} title="Delete this item?" description="This is an example — nothing is deleted." confirmLabel="Delete" />
      </Section>

      <Section title="Tabs">
        <Tabs label="Example tabs" tabs={[{ key: "a", label: "Overview", content: <p className="type-body">Overview panel</p> }, { key: "b", label: "Details", content: <p className="type-body">Details panel</p> }, { key: "c", label: "History", content: <p className="type-body">History panel</p> }]} />
      </Section>

      <Section title="Table & pagination (stacks on mobile)">
        <div className="-mx-card"><DataTable caption="Example table" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} /></div>
        <Pagination page={page} pageCount={5} onPageChange={setPage} />
      </Section>

      <Section title="Loading, empty & error states">
        <div className="grid gap-4 md:grid-cols-2">
          <Card><LoadingState /></Card>
          <Card><EmptyState title="No patients yet" description="Patients you register will appear here." /></Card>
          <Card><EmptyState title="No appointments scheduled" /></Card>
          <Card><EmptyState title="No reports available" /></Card>
          <Card><ErrorState code="INTERNAL" /></Card>
          <Card><ErrorState code="NETWORK_ERROR" /></Card>
          <Card><ErrorState code="FORBIDDEN" /></Card>
          <Card className="space-y-2 p-card"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></Card>
        </div>
      </Section>
    </div>
  );
}
