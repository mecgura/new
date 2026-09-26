import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, ShoppingBag, Pencil, Trash2, Link2, IndianRupee, Copy } from 'lucide-react'
import { post, put, del, patch } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { inr, dateTime, phone } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Tabs, Textarea, Toggle, useToast, statusTone, Confirm, Stat } from '../../components/ui'

type Product = { id: number; name: string; description: string | null; price: number; currency: string; image_url: string | null; retailer_id: string | null; category: string | null; stock: number | null; is_active: number }
type Order = { id: number; contact_name: string | null; wa_id: string; items: { name: string; qty: number; price: number }[]; total: number; status: string; payment_status: string; source: string; created_at: string }
type Payment = { id: number; contact_name: string | null; wa_id: string; amount: number; description: string; status: string; short_url: string | null; created_at: string; paid_at: string | null }

function ProductModal({ p, onClose, onSaved }: { p: Partial<Product>; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState<Partial<Product>>({ name: '', description: '', price: 0, currency: 'INR', image_url: '', retailer_id: '', category: '', is_active: 1, ...p })
  return (
    <Modal open onClose={onClose} title={p.id ? 'Edit product' : 'Add product'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      const body = { name: f.name, description: f.description || undefined, price: Number(f.price), currency: f.currency, image_url: f.image_url || '', retailer_id: f.retailer_id || undefined, category: f.category || undefined, is_active: !!f.is_active }
      try { if (p.id) await put(`products/${p.id}`, body); else await post('products', body); onSaved(); onClose() } catch (e) { t.err(e) }
    }}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Price (₹)"><Input type="number" value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} /></Field><Field label="Category"><Input value={f.category ?? ''} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field></div>
        <Field label="Description"><Textarea rows={3} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Image URL"><Input value={f.image_url ?? ''} onChange={(e) => setF({ ...f, image_url: e.target.value })} placeholder="https://…" /></Field>
        <Field label="Meta catalogue content ID (optional)" hint="Set if this product exists in your Meta Commerce catalogue — enables native WhatsApp product cards and cart orders"><Input value={f.retailer_id ?? ''} onChange={(e) => setF({ ...f, retailer_id: e.target.value })} /></Field>
        <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v ? 1 : 0 })} label="Active" />
      </div>
    </Modal>
  )
}

export default function Commerce() {
  const t = useToast()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'catalogue') as 'catalogue' | 'orders' | 'payments'
  const { data: products, reload: rp } = useApi<Product[]>('products')
  const { data: orders, reload: ro } = useApi<Order[]>(tab === 'orders' ? 'orders' : null)
  const { data: payments } = useApi<Payment[]>(tab === 'payments' ? 'payments' : null)
  const { data: ws } = useApi<{ settings: { catalog_id?: string } }>('workspace')
  const [edit, setEdit] = useState<Partial<Product> | null>(null)
  const [delId, setDelId] = useState<number | null>(null)
  const [catalogId, setCatalogId] = useState<string | null>(null)
  const paid = (payments ?? []).filter((p) => p.status === 'paid')
  return (
    <>
      <PageHeader title="Catalogue & payments" subtitle="Share products in chat, receive WhatsApp cart orders and collect payments with Razorpay links."
        actions={tab === 'catalogue' && <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Add product</Button>} />
      <div className="mb-5"><Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[{ id: 'catalogue', label: 'Catalogue' }, { id: 'orders', label: 'Orders' }, { id: 'payments', label: 'Payments' }]} /></div>

      {tab === 'catalogue' && <>
        <Card className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Meta Commerce catalogue ID (optional)" className="flex-1" hint="Connect your catalogue in Meta Commerce Manager to show native product cards and receive cart orders.">
              <Input value={catalogId ?? ws?.settings.catalog_id ?? ''} onChange={(e) => setCatalogId(e.target.value)} placeholder="e.g. 1234567890" />
            </Field>
            <Button variant="subtle" onClick={async () => { try { await patch('workspace', { settings: { catalog_id: catalogId ?? '' } }); t.ok('Saved') } catch (e) { t.err(e) } }}>Save</Button>
          </div>
        </Card>
        {!products ? <Loading /> : products.length === 0 ? <Card><Empty icon={<ShoppingBag className="size-5" />} title="No products yet" text="Add products or services to share them in chats with price, image and a Pay button." action={<Button onClick={() => setEdit({})}>Add product</Button>} /></Card> : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <Card key={p.id} pad={false} className="overflow-hidden">
                {p.image_url ? <img src={p.image_url} alt={p.name} className="h-40 w-full object-cover" /> : <div className="grid h-40 place-items-center bg-raised"><ShoppingBag className="size-8 text-line-strong" /></div>}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2"><div className="font-medium text-white">{p.name}</div>{!p.is_active && <Badge>hidden</Badge>}</div>
                  <div className="mt-1 font-display text-lg font-bold text-brand-2">{inr(p.price)}</div>
                  {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>}
                  <div className="mt-3 flex gap-2"><Button size="sm" variant="subtle" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(p)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDelId(p.id)}><Trash2 className="size-4" /></Button></div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </>}

      {tab === 'orders' && (
        <Card pad={false}>
          {!orders ? <Loading /> : orders.length === 0 ? <Empty title="No orders yet" text="Orders from WhatsApp carts appear here automatically. You can also create orders from the API." /> : (
            <Table head={['Order', 'Customer', 'Items', 'Total', 'Payment', 'Status', '']}>
              {orders.map((o) => (
                <tr key={o.id}>
                  <Td><div className="font-medium text-white">#{o.id}</div><div className="text-xs text-muted">{dateTime(o.created_at)} · {o.source.replace('_', ' ')}</div></Td>
                  <Td><div className="text-white">{o.contact_name || '—'}</div><div className="text-xs text-muted">{phone(o.wa_id)}</div></Td>
                  <Td className="max-w-56 text-xs">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</Td>
                  <Td className="font-medium text-white">{inr(o.total)}</Td>
                  <Td><Badge tone={statusTone(o.payment_status === 'paid' ? 'paid' : 'pending')}>{o.payment_status}</Badge></Td>
                  <Td><Select className="!h-8 w-32 text-xs" value={o.status} onChange={async (e) => { await patch(`orders/${o.id}`, { status: e.target.value }); void ro() }}>{['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></Td>
                  <Td>{o.payment_status !== 'paid' && <Button size="sm" variant="subtle" icon={<Link2 className="size-3.5" />} onClick={async () => { try { await post(`orders/${o.id}/payment-link`); t.ok('Payment link sent on WhatsApp') } catch (e) { t.err(e) } }}>Send pay link</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'payments' && <>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Collected" value={inr(paid.reduce((s, p) => s + p.amount, 0))} icon={<IndianRupee className="size-4" />} />
          <Stat label="Paid links" value={paid.length} />
          <Stat label="Pending links" value={(payments ?? []).filter((p) => p.status !== 'paid').length} />
        </div>
        <Card pad={false}>
          {!payments ? <Loading /> : payments.length === 0 ? <Empty title="No payment requests yet" text={<>Connect Razorpay in <Link to="/app/settings?tab=integrations" className="text-brand-2">Settings → Integrations</Link>, then use the ₹ button in any chat.</>} /> : (
            <Table head={['Customer', 'For', 'Amount', 'Status', 'Created', 'Link']}>
              {payments.map((p) => (
                <tr key={p.id}>
                  <Td><div className="text-white">{p.contact_name || '—'}</div><div className="text-xs text-muted">{phone(p.wa_id)}</div></Td>
                  <Td>{p.description}</Td><Td className="font-medium text-white">{inr(p.amount)}</Td>
                  <Td><Badge tone={statusTone(p.status)}>{p.status}</Badge></Td><Td className="text-xs">{dateTime(p.paid_at ?? p.created_at)}</Td>
                  <Td>{p.short_url && <button className="text-muted hover:text-white" onClick={() => { void navigator.clipboard.writeText(p.short_url!); t.ok('Link copied') }}><Copy className="size-4" /></button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </>}

      {edit && <ProductModal p={edit} onClose={() => setEdit(null)} onSaved={rp} />}
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Delete product?" text="The product will be removed from your catalogue." onConfirm={async () => { await del(`products/${delId}`); void rp() }} />
    </>
  )
}
