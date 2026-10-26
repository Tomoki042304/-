import type { SupabaseClient } from '@supabase/supabase-js'

export type Profile = {
  user_id: string
  display_name: string
  created_at: string
  updated_at: string
}

export function validateDisplayName(input: string): { name: string; error: string | null } {
  const name = input.trim()
  if (!name) return { name, error: '表示名を入力してください。' }
  if (Array.from(name).length > 80) return { name, error: '表示名は80文字以内で入力してください。' }
  return { name, error: null }
}

function isProfile(value: unknown, userId: string): value is Profile {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && typeof row.display_name === 'string'
    && typeof row.created_at === 'string' && typeof row.updated_at === 'string'
    && Number.isFinite(Date.parse(row.updated_at))
}

export async function readProfile(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Profile | null> {
  const { data, error } = await client.from('shidoroku_profiles')
    .select('user_id,display_name,created_at,updated_at').eq('user_id', userId)
    .abortSignal(signal).maybeSingle()
  if (error || (data !== null && !isProfile(data, userId))) throw new Error('Profile read failed')
  return data
}

export async function saveProfile(
  client: SupabaseClient, userId: string, input: string, previous: Profile | null, signal: AbortSignal,
): Promise<Profile> {
  const { name, error: validationError } = validateDisplayName(input)
  if (validationError || (previous && previous.user_id !== userId)) throw new Error('Invalid profile input')
  const table = client.from('shidoroku_profiles')
  // Avoid UPSERT: updates may only change display_name. Compare the last read
  // timestamp so a different tab's newer edit is not silently overwritten.
  const query = previous
    ? table.update({ display_name: name }).eq('user_id', userId).eq('updated_at', previous.updated_at)
    : table.insert({ user_id: userId, display_name: name })
  const { data, error } = await query.select('user_id,display_name,created_at,updated_at')
    .abortSignal(signal).maybeSingle()
  if (error || !isProfile(data, userId) || data.display_name !== name) {
    throw new Error('Profile save not confirmed')
  }
  return data
}
