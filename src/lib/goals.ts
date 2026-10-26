import type { SupabaseClient } from '@supabase/supabase-js'

export type GoalInput = {
  title: string
  description: string
  targetDate: string
  status: 'in_progress' | 'achieved'
}
export type Goal = {
  id: string
  user_id: string
  title: string
  description: string
  target_date: string | null
  status: 'in_progress' | 'achieved'
  created_at: string
  updated_at: string
}
const columns = 'id,user_id,title,description,target_date,status,created_at,updated_at'
export const goalsPageSize = 20
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGoalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateGoal(input: GoalInput): { value: GoalInput; error: string | null } {
  const value = { ...input, title: input.title.trim(), description: input.description.trim() }
  if (!value.title) return { value, error: '目標のタイトルを入力してください。' }
  if (Array.from(value.title).length > 120) return { value, error: 'タイトルは120文字以内で入力してください。' }
  if (Array.from(value.description).length > 2000) return { value, error: '補足は2000文字以内で入力してください。' }
  if (value.targetDate && !isGoalDate(value.targetDate)) return { value, error: '目標日を正しい日付で入力してください。' }
  if (!['in_progress', 'achieved'].includes(value.status)) return { value, error: '目標の状態を確認してください。' }
  return { value, error: null }
}

export function goalInput(goal: Goal): GoalInput {
  return { title: goal.title, description: goal.description, targetDate: goal.target_date ?? '', status: goal.status }
}

function isGoal(value: unknown, userId: string): value is Goal {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && typeof row.id === 'string' && uuid.test(row.id)
    && typeof row.title === 'string' && typeof row.description === 'string'
    && (row.target_date === null || (typeof row.target_date === 'string' && isGoalDate(row.target_date)))
    && (row.status === 'in_progress' || row.status === 'achieved')
    && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
    && typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at))
}

export async function listGoals(client: SupabaseClient, userId: string, offset: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid goal offset')
  const { data, error } = await client.from('shidoroku_goals').select(columns).eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .abortSignal(signal).range(offset, offset + goalsPageSize)
  if (error || !Array.isArray(data) || !data.every(row => isGoal(row, userId))) throw new Error('Goal list failed')
  return { goals: (data as Goal[]).slice(0, goalsPageSize), hasMore: data.length > goalsPageSize }
}

export async function readGoal(client: SupabaseClient, userId: string, id: string, signal: AbortSignal): Promise<Goal | null> {
  if (!uuid.test(id)) throw new Error('Invalid goal ID')
  const { data, error } = await client.from('shidoroku_goals').select(columns)
    .eq('user_id', userId).eq('id', id).abortSignal(signal).maybeSingle()
  if (error || (data !== null && (!isGoal(data, userId) || data.id !== id))) throw new Error('Goal read failed')
  return data
}

export async function saveGoal(
  client: SupabaseClient, userId: string, id: string, input: GoalInput, previous: Goal | null, signal: AbortSignal,
): Promise<Goal> {
  const { value, error: validationError } = validateGoal(input)
  if (validationError || !uuid.test(id) || (previous && (previous.user_id !== userId || previous.id !== id))) {
    throw new Error('Invalid goal input')
  }
  const fields = { title: value.title, description: value.description, target_date: value.targetDate || null, status: value.status }
  const table = client.from('shidoroku_goals')
  // Keep a stable client-generated ID across uncertain INSERT outcomes, never UPSERT.
  const query = previous
    ? table.update(fields).eq('user_id', userId).eq('id', id).eq('updated_at', previous.updated_at)
    : table.insert({ id, user_id: userId, ...fields })
  const { data, error } = await query.select(columns).abortSignal(signal).maybeSingle()
  if (error || !isGoal(data, userId) || data.id !== id || data.title !== fields.title
    || data.description !== fields.description || data.target_date !== fields.target_date || data.status !== fields.status) {
    throw new Error('Goal save not confirmed')
  }
  return data
}
