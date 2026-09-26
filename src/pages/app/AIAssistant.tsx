import { useState } from 'react'
import { Sparkles, BookOpen, ShieldAlert, Wand2 } from 'lucide-react'
import { patch, post } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Button, Card, Field, Input, Loading, PageHeader, Select, Textarea, Toggle, TagInput, useToast, cx } from '../../components/ui'

type Ai = { enabled?: boolean; mode?: 'off' | 'suggest' | 'auto'; persona?: string; knowledge?: string; handoff_keywords?: string[]; language?: string; max_replies_per_chat?: number }

type WsData = { settings: { ai?: Ai }; plan: { features: string[] }; usage: Record<string, { used: number; limit: number }> }

export default function AIAssistant() {
  const { data } = useApi<WsData>('workspace')
  return data ? <AIForm data={data} /> : <Loading />
}

function AIForm({ data }: { data: WsData }) {
  const t = useToast()
  const [ai, setAi] = useState<Ai>(data.settings.ai ?? {})
  const [busy, setBusy] = useState(false)
  const [brief, setBrief] = useState(''); const [out, setOut] = useState(''); const [wBusy, setWBusy] = useState(false)
  const locked = !data.plan.features.includes('ai')
  const u = data.usage.ai_replies
  return (
    <>
      <PageHeader title="AI assistant" subtitle="Answers customer questions 24/7 using your business knowledge — and hands over to your team when it is unsure."
        actions={<Button loading={busy} disabled={locked} onClick={async () => { setBusy(true); try { await patch('workspace', { settings: { ai } }); t.ok('AI settings saved') } catch (e) { t.err(e) } finally { setBusy(false) } }}>Save</Button>} />
      {locked && <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">AI assistant is available on Growth and higher plans. <a href="/app/billing" className="underline">Upgrade</a></div>}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Mode" action={<Toggle checked={!!ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} label={ai.enabled ? 'On' : 'Off'} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['suggest', 'Suggest replies', 'AI drafts replies in the inbox. Agents review and send.'], ['auto', 'Auto-reply', 'AI replies to customers automatically when no flow or rule matches.']] as const).map(([id, l, d]) => (
                <button key={id} onClick={() => setAi({ ...ai, mode: id })} className={cx('rounded-xl border p-4 text-left transition', ai.mode === id ? 'border-brand/60 bg-brand/10' : 'border-line bg-panel hover:border-line-strong')}>
                  <div className="font-medium text-white">{l}</div><div className="mt-1 text-xs text-muted">{d}</div>
                </button>
              ))}
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><BookOpen className="size-4 text-brand" />Knowledge base</span>}>
            <Textarea rows={12} value={ai.knowledge ?? ''} onChange={(e) => setAi({ ...ai, knowledge: e.target.value })}
              placeholder={'Write everything the AI should know:\n\n• What you sell and prices\n• Timings, address, delivery areas\n• Offers running now\n• Refund / cancellation policy\n• FAQs and how to book'} />
            <p className="mt-2 text-xs text-muted">The AI will only use facts from here and your product catalogue. It will not invent prices or policies.</p>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Personality">
            <div className="space-y-4">
              <Field label="Tone & persona"><Input value={ai.persona ?? ''} onChange={(e) => setAi({ ...ai, persona: e.target.value })} placeholder="Warm, helpful and concise" /></Field>
              <Field label="Language"><Select value={ai.language ?? ''} onChange={(e) => setAi({ ...ai, language: e.target.value })}>
                <option value="">Match the customer automatically</option><option>English</option><option>Hindi</option><option>Punjabi</option><option>Hinglish</option>
              </Select></Field>
              <Field label="Max AI replies per chat per day"><Input type="number" min={1} value={ai.max_replies_per_chat ?? 15} onChange={(e) => setAi({ ...ai, max_replies_per_chat: Number(e.target.value) })} /></Field>
            </div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><ShieldAlert className="size-4 text-brand" />Human handoff</span>}>
            <Field label="Hand over when the customer says" hint="The chat is assigned to an agent and the bot pauses"><TagInput value={ai.handoff_keywords ?? []} onChange={(v) => setAi({ ...ai, handoff_keywords: v })} /></Field>
          </Card>
          <Card><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-soft"><Sparkles className="size-4 text-brand" />AI replies this month</span><b className="text-white">{u.used.toLocaleString('en-IN')} / {u.limit < 0 ? '∞' : u.limit.toLocaleString('en-IN')}</b></div></Card>
          <Card title={<span className="flex items-center gap-2"><Wand2 className="size-4 text-brand" />AI copywriter</span>}>
            <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Broadcast for Navratri: 15% off on all dresses till Sunday, free delivery in Ludhiana" />
            <Button className="mt-2" size="sm" variant="subtle" loading={wBusy} disabled={locked || !brief} onClick={async () => { setWBusy(true); try { setOut((await post<{ text: string }>('ai/write', { kind: 'broadcast', brief })).text) } catch (e) { t.err(e) } finally { setWBusy(false) } }}>Write message</Button>
            {out && <div className="mt-3 whitespace-pre-wrap rounded-xl border border-line bg-panel p-3 text-sm text-soft">{out}</div>}
          </Card>
        </div>
      </div>
    </>
  )
}
