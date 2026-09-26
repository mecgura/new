import { useState } from 'react'
import { UserPlus, Copy, Trash2, Check, X as XIcon, Circle, Shuffle } from 'lucide-react'
import { post, patch, put, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { ago, date, titleCase } from '../../lib/format'
import { Avatar, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, useToast, Confirm, cx } from '../../components/ui'
import type { Member } from '../../lib/types'

type TeamData = { members: Member[]; invites: { id: number; email: string; role: string; link: string; expires_at: string }[]; roles: string[]; permissions: Record<string, string>; role_permissions: Record<string, string[]> }

export default function Team() {
  const t = useToast()
  const { can, user, ws } = useSession()
  const { data, reload } = useApi<TeamData>('team')
  const [inv, setInv] = useState({ open: false, email: '', role: 'agent', link: '' })
  const [rm, setRm] = useState<number | null>(null)
  if (!data) return <Loading />
  const manage = can('team.manage')
  return (
    <>
      <PageHeader title="Team & roles" subtitle="Invite teammates, set their role and control who sees what." actions={manage && <Button icon={<UserPlus className="size-4" />} onClick={() => setInv({ open: true, email: '', role: 'agent', link: '' })}>Invite member</Button>} />
      <Card pad={false}>
        <Table head={['Member', 'Role', 'Status', 'Open chats', 'Last login', '']}>
          {data.members.map((m) => (
            <tr key={m.id}>
              <Td><div className="flex items-center gap-3"><Avatar name={m.name} /><div><div className="font-medium text-white">{m.name}{m.user_id === user?.id && <span className="text-muted"> (you)</span>}</div><div className="text-xs text-muted">{m.email}</div></div></div></Td>
              <Td>{manage && ['owner', 'admin'].includes(ws?.role ?? '') && m.user_id !== user?.id ? (
                <Select className="!h-8 w-32 text-xs capitalize" value={m.role} onChange={async (e) => { try { await patch(`team/members/${m.id}`, { role: e.target.value }); void reload() } catch (er) { t.err(er) } }}>{data.roles.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select>
              ) : <Badge tone={m.role === 'owner' ? 'green' : 'gray'}>{m.role}</Badge>}</Td>
              <Td><button disabled={m.user_id !== user?.id && !manage} onClick={async () => { await patch(`team/members/${m.id}`, { is_online: !m.is_online }); void reload() }} className="flex items-center gap-1.5 text-xs">
                <Circle className={cx('size-2.5', m.is_online ? 'fill-brand text-brand' : 'fill-muted text-muted')} />{m.is_online ? 'Available' : 'Away'}</button></Td>
              <Td>{m.open_chats}</Td>
              <Td className="text-xs">{m.last_login_at ? ago(m.last_login_at) + ' ago' : '—'}</Td>
              <Td className="text-right">{manage && m.role !== 'owner' && <button onClick={() => setRm(m.id)} className="text-muted hover:text-red-300"><Trash2 className="size-4" /></button>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <AutoAssignCard members={data.members} manage={manage} />
      {data.invites.length > 0 && <Card className="mt-5" title="Pending invites" pad={false}>
        <Table head={['Email', 'Role', 'Expires', '']}>
          {data.invites.map((i) => <tr key={i.id}><Td className="text-white">{i.email}</Td><Td><Badge>{i.role}</Badge></Td><Td className="text-xs">{date(i.expires_at)}</Td>
            <Td className="text-right"><button className="mr-3 text-muted hover:text-white" onClick={() => { void navigator.clipboard.writeText(i.link); t.ok('Invite link copied') }}><Copy className="size-4" /></button>
              {manage && <button className="text-muted hover:text-red-300" onClick={async () => { await del(`team/invites/${i.id}`); void reload() }}><Trash2 className="size-4" /></button>}</Td></tr>)}
        </Table>
      </Card>}
      <Card className="mt-5" title="What each role can do" pad={false}>
        <Table head={['Permission', ...data.roles.map(titleCase)]}>
          {Object.entries(data.permissions).map(([k, label]) => <tr key={k}><Td className="text-soft">{label}</Td>{data.roles.map((r) => <Td key={r}>{data.role_permissions[r]?.includes(k) ? <Check className="size-4 text-brand" /> : <XIcon className="size-4 text-line-strong" />}</Td>)}</tr>)}
        </Table>
      </Card>
      <Modal open={inv.open} onClose={() => setInv({ ...inv, open: false })} title="Invite a team member" footer={inv.link ? <Button onClick={() => setInv({ ...inv, open: false })}>Done</Button> : <Button onClick={async () => {
        try { const r = await post<{ link: string; email_sent: boolean }>('team/invites', { email: inv.email, role: inv.role }); setInv({ ...inv, link: r.link }); if (r.email_sent) t.ok(`Invite emailed to ${inv.email}`); void reload() } catch (e) { t.err(e) }
      }}>Create invite</Button>}>
        {inv.link ? <div><p className="text-sm text-soft">Share this link with <b className="text-white">{inv.email}</b> (valid 7 days):</p>
          <div className="mt-3 flex gap-2"><Input readOnly value={inv.link} /><Button variant="subtle" onClick={() => { void navigator.clipboard.writeText(inv.link); t.ok('Copied') }}><Copy className="size-4" /></Button></div>
          <a className="mt-3 inline-block text-sm text-brand-2" href={`https://wa.me/?text=${encodeURIComponent(`Join our team on MECGURA WhatsApp: ${inv.link}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp →</a></div> : (
          <div className="space-y-4">
            <Field label="Email"><Input type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
            <Field label="Role" hint={inv.role === 'agent' ? 'Agents see unassigned chats and chats assigned to them.' : undefined}><Select value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{data.roles.filter((r) => r !== 'owner' || ws?.role === 'owner').map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}</Select></Field>
          </div>
        )}
      </Modal>
      <Confirm open={!!rm} onClose={() => setRm(null)} title="Remove member?" text="They lose access immediately. Their open chats become unassigned." confirmLabel="Remove" onConfirm={async () => { await del(`team/members/${rm}`); void reload() }} />
    </>
  )
}

type AutoAssign = { mode: 'off' | 'round_robin' | 'least_busy'; members: number[]; max_open: number; only_online: boolean }

function AutoAssignCard({ members, manage }: { members: Member[]; manage: boolean }) {
  const { data } = useApi<AutoAssign>('team/auto-assign')
  if (!data) return null
  return <AutoAssignForm key={JSON.stringify(data)} initial={data} members={members} manage={manage} />
}

function AutoAssignForm({ initial, members, manage }: { initial: AutoAssign; members: Member[]; manage: boolean }) {
  const t = useToast()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toggle = (uid: number) => setS({ ...s, members: s.members.includes(uid) ? s.members.filter((m) => m !== uid) : [...s.members, uid] })
  const save = async () => {
    setBusy(true)
    try { setS(await put<AutoAssign>('team/auto-assign', s)); t.ok('Auto-assign saved') } catch (e) { t.err(e) } finally { setBusy(false) }
  }
  return (
    <Card className="mt-5" title="Auto-assign chats" action={<Shuffle className="size-4 text-brand" />}>
      <p className="text-sm text-soft">New WhatsApp chats go straight to an agent, so no customer waits in the unassigned queue. A returning customer stays with the same agent.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Method"><Select disabled={!manage} value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value as AutoAssign['mode'] })}>
          <option value="off">Off — agents pick chats manually</option>
          <option value="round_robin">Round robin — take turns</option>
          <option value="least_busy">Least busy — fewest open chats</option>
        </Select></Field>
        <Field label="Max open chats per agent" hint="0 = no limit"><Input disabled={!manage} type="number" min={0} value={s.max_open} onChange={(e) => setS({ ...s, max_open: Math.max(0, Number(e.target.value) || 0) })} /></Field>
        <Field label="Availability"><label className="flex h-10 items-center gap-2 text-sm text-soft"><input disabled={!manage} type="checkbox" checked={s.only_online} onChange={(e) => setS({ ...s, only_online: e.target.checked })} className="accent-emerald-500" />Only agents marked Available</label></Field>
      </div>
      <div className="mt-4">
        <div className="text-xs font-medium text-muted">Who receives chats <span className="font-normal">(none selected = everyone)</span></div>
        <div className="mt-2 flex flex-wrap gap-2">
          {members.map((m) => <button key={m.user_id} disabled={!manage} onClick={() => toggle(m.user_id)}
            className={cx('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs', s.members.includes(m.user_id) ? 'border-brand bg-brand/10 text-white' : 'border-line text-soft hover:border-line-strong')}>
            {s.members.includes(m.user_id) && <Check className="size-3 text-brand" />}{m.name} <span className="text-muted capitalize">· {m.role}</span></button>)}
        </div>
      </div>
      {manage && <div className="mt-4"><Button loading={busy} onClick={save}>Save</Button></div>}
    </Card>
  )
}
