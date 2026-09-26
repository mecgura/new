export const ROLES = ['owner', 'admin', 'manager', 'agent', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = {
  'inbox.view': 'View inbox',
  'inbox.reply': 'Reply to chats',
  'inbox.assign': 'Assign & transfer chats',
  'inbox.all': 'See all chats (not only assigned)',
  'contacts.view': 'View contacts & CRM',
  'contacts.manage': 'Create, edit, import, delete contacts',
  'campaigns.manage': 'Create & send campaigns',
  'templates.manage': 'Manage message templates',
  'automation.manage': 'Chatbots, flows, follow-ups & AI',
  'commerce.manage': 'Catalogue, orders & payments',
  'analytics.view': 'View analytics',
  'numbers.manage': 'Connect WhatsApp numbers',
  'team.manage': 'Manage team & roles',
  'developers.manage': 'API keys & webhooks',
  'billing.manage': 'Plans & billing',
  'settings.manage': 'Workspace settings',
} as const
export type Permission = keyof typeof PERMISSIONS

const all = Object.keys(PERMISSIONS) as Permission[]
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: all,
  admin: all.filter((p) => p !== 'billing.manage'),
  manager: ['inbox.view', 'inbox.reply', 'inbox.assign', 'inbox.all', 'contacts.view', 'contacts.manage', 'campaigns.manage',
    'templates.manage', 'automation.manage', 'commerce.manage', 'analytics.view'],
  agent: ['inbox.view', 'inbox.reply', 'contacts.view'],
  viewer: ['inbox.view', 'inbox.all', 'contacts.view', 'analytics.view'],
}

export const can = (role: string, p: Permission) => (ROLE_PERMISSIONS[role as Role] ?? []).includes(p)
