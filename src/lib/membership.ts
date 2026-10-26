export type Membership = {
  user_id: string
  member_id: string
  role: 'member' | 'admin'
  status: 'active' | 'suspended'
}

export function isActiveMembership(value: unknown, userId: string): value is Membership {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && typeof row.member_id === 'string' && row.member_id.length > 0
    && (row.role === 'member' || row.role === 'admin') && row.status === 'active'
}
