import { get, insert, run, now } from './db.ts'
import { config } from './config.ts'
import { hashPassword } from './lib/security.ts'
import { seedPlans } from './services/plans.ts'
import { createWorkspace } from './routes/auth.ts'

export function seed() {
  seedPlans()
  if (config.admin.password) {
    const u = get<{ id: number }>('SELECT id FROM users WHERE email = ?', config.admin.email)
    if (!u) {
      const uid = insert('users', { email: config.admin.email, name: 'MECGURA Admin', password_hash: hashPassword(config.admin.password), is_super_admin: 1, created_at: now() })
      createWorkspace('MECGURA', uid, { email: config.brand.email, phone: config.brand.phone, website: config.brand.website })
      console.log(`Super admin created: ${config.admin.email}`)
    } else run('UPDATE users SET is_super_admin = 1 WHERE id = ?', u.id)
  }
  if (config.seedDemo) seedDemo()
}

// Optional demo data so a sales demo looks alive on day one.
function seedDemo() {
  const admin = get<{ id: number }>('SELECT id FROM users WHERE is_super_admin = 1 LIMIT 1')
  if (!admin) return
  const ws = get<{ id: number }>("SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ? LIMIT 1", admin.id)!
  if (get('SELECT id FROM wa_numbers WHERE workspace_id = ?', ws.id)) return
  const t = now()
  const nid = insert('wa_numbers', { workspace_id: ws.id, label: 'Sandbox (demo)', phone_number_id: `demo${ws.id}000001`, display_phone: '+91 00000 00000', verified_name: 'MECGURA Demo', quality_rating: 'GREEN', is_default: 1, is_demo: 1, status: 'connected', created_at: t })
  insert('templates', { workspace_id: ws.id, number_id: nid, name: 'festive_offer', language: 'en', category: 'MARKETING', status: 'APPROVED', created_at: t, updated_at: t,
    components: [{ type: 'BODY', text: 'Hi {{1}} 🎉 Our festive sale is live! Get {{2}} off on all services this week. Reply YES to book.', example: { body_text: [['Aman', '20%']] } }, { type: 'FOOTER', text: 'Reply STOP to opt out' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'YES' }, { type: 'QUICK_REPLY', text: 'Not now' }] }] })
  insert('templates', { workspace_id: ws.id, number_id: nid, name: 'order_update', language: 'en', category: 'UTILITY', status: 'APPROVED', created_at: t, updated_at: t,
    components: [{ type: 'BODY', text: 'Hello {{1}}, your order #{{2}} is {{3}}. Thank you for shopping with us!', example: { body_text: [['Aman', '1024', 'shipped']] } }] })
  const people = [['Aman Sharma', '919876500001', ['lead', 'website'], 'qualified'], ['Priya Kaur', '919876500002', ['customer'], 'won'], ['Rohit Verma', '919876500003', ['lead'], 'new'],
    ['Simran Gill', '919876500004', ['lead', 'instagram'], 'contacted'], ['Karan Mehta', '919876500005', ['customer', 'vip'], 'won'], ['Neha Arora', '919876500006', ['lead'], 'proposal']] as const
  for (const [name, wa, tags, stage] of people) insert('contacts', { workspace_id: ws.id, wa_id: wa, name, tags: [...tags], stage, source: 'demo', deal_value: Math.round(Math.random() * 40000), created_at: t })
  insert('bot_rules', { workspace_id: ws.id, name: 'Pricing', match_type: 'contains', keywords: ['price', 'pricing', 'cost', 'rate'], priority: 5, created_at: t,
    reply: { type: 'buttons', text: 'Our plans start at ₹999/month. What would you like to do next?', buttons: ['See plans', 'Book a demo', 'Talk to team'] } })
  insert('products', { workspace_id: ws.id, name: 'Website Design Package', description: 'Modern 5-page business website', price: 14999, currency: 'INR', created_at: t })
  insert('products', { workspace_id: ws.id, name: 'Social Media Management', description: '12 posts + 4 reels per month', price: 9999, currency: 'INR', created_at: t })
  insert('flows', { workspace_id: ws.id, name: 'Lead capture', description: 'Qualifies new leads and hands off to sales', is_active: 1, created_at: t, updated_at: t,
    trigger: { type: 'keyword', value: 'hi,hello,demo', match: 'exact' },
    nodes: [
      { id: 'n1', type: 'message', data: { reply: { type: 'text', text: 'Hi {{first_name}} 👋 Welcome to MECGURA!' } }, next: 'n2', x: 0, y: 0 },
      { id: 'n2', type: 'buttons', data: { text: 'What are you looking for?', options: ['Website', 'Marketing', 'WhatsApp'], save_as: 'interest' }, branches: { 0: 'n3', 1: 'n3', 2: 'n3', other: 'n3' }, x: 0, y: 1 },
      { id: 'n3', type: 'question', data: { text: 'Great choice! What is your business name?', save_as: 'business_name' }, next: 'n4', x: 0, y: 2 },
      { id: 'n4', type: 'action', data: { action: 'add_tag', value: 'hot-lead' }, next: 'n5', x: 0, y: 3 },
      { id: 'n5', type: 'handoff', data: { text: 'Thanks! Our team will message you shortly about {{interest}} for {{business_name}}.' }, x: 0, y: 4 },
    ] })
}
