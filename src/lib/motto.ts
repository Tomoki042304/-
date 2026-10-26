import type { SupabaseClient } from '@supabase/supabase-js'

export type Motto = {
  user_id: string
  content: string
  created_at: string
  updated_at: string
}

export function validateMotto(input: string): { name: string; error: string | null } {
  const name = input.trim()
  if (!name) return { name, error: '志言を入力してください。' }
  if (Array.from(name).length > 500) return { name, error: '志言は500文字以内で入力してください。' }
  return { name, error: null }
}

function isMotto(value: unknown, userId: string): value is Motto {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && typeof row.content === 'string'
    && typeof row.created_at === 'string' && typeof row.updated_at === 'string'
    && Number.isFinite(Date.parse(row.updated_at))
}

export async function readMotto(client: SupabaseClient, userId: string, signal: AbortSignal): Promise<Motto | null> {
  const { data, error } = await client.from('shidoroku_mottos')
    .select('user_id,content,created_at,updated_at').eq('user_id', userId)
    .abortSignal(signal).maybeSingle()
  if (error || (data !== null && !isMotto(data, userId))) throw new Error('Motto read failed')
  return data
}

export async function saveMotto(
  client: SupabaseClient, userId: string, input: string, previous: Motto | null, signal: AbortSignal,
): Promise<Motto> {
  const { name, error: validationError } = validateMotto(input)
  if (validationError || (previous && previous.user_id !== userId)) throw new Error('Invalid motto input')
  const table = client.from('shidoroku_mottos')
  // Avoid UPSERT: updates may only change content. Compare the last read
  // timestamp so a different tab's newer edit is not silently overwritten.
  const query = previous
    ? table.update({ content: name }).eq('user_id', userId).eq('updated_at', previous.updated_at)
    : table.insert({ user_id: userId, content: name })
  const { data, error } = await query.select('user_id,content,created_at,updated_at')
    .abortSignal(signal).maybeSingle()
  if (error || !isMotto(data, userId) || data.content !== name) {
    throw new Error('Motto save not confirmed')
  }
  return data
}
