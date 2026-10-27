import type { SupabaseClient } from '@supabase/supabase-js'
import { isGoalDate } from './goals.ts'

export type HabitInput = { name: string; note: string; status: 'active' | 'paused' }
export type HabitLog = { habit_id: string; user_id: string; log_date: string; completed_at: string }
export type Habit = HabitInput & { id: string; user_id: string; created_at: string; updated_at: string; logs: HabitLog[] }
const columns = 'id,user_id,name,note,status,created_at,updated_at'
const logColumns = 'habit_id,user_id,log_date,completed_at'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const habitsPageSize = 20

export function todayInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find(value => value.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function recentHabitDays(day: string): string[] {
  if (!isGoalDate(day)) throw new Error('Invalid habit day')
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(day + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() - 6 + index)
    return date.toISOString().slice(0, 10)
  })
}

export function validateHabit(input: HabitInput): { value: HabitInput; error: string | null } {
  const value: HabitInput = { name: input.name.trim(), note: input.note.trim(), status: input.status }
  if (!value.name) return { value, error: '習慣名を入力してください。' }
  if (Array.from(value.name).length > 120) return { value, error: '習慣名は120文字以内で入力してください。' }
  if (Array.from(value.note).length > 1000) return { value, error: '習慣の補足は1000文字以内で入力してください。' }
  if (!['active', 'paused'].includes(value.status)) return { value, error: '習慣の状態を確認してください。' }
  return { value, error: null }
}

export function habitInput(habit: Habit): HabitInput {
  return { name: habit.name, note: habit.note, status: habit.status }
}

function isHabitRow(value: unknown, userId: string): value is Omit<Habit, 'logs'> {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && typeof row.id === 'string' && uuid.test(row.id)
    && typeof row.name === 'string' && typeof row.note === 'string' && (row.status === 'active' || row.status === 'paused')
    && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
    && typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at))
}

function isLog(value: unknown, userId: string, habitId: string): value is HabitLog {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.user_id === userId && row.habit_id === habitId && typeof row.log_date === 'string' && isGoalDate(row.log_date)
    && typeof row.completed_at === 'string' && Number.isFinite(Date.parse(row.completed_at))
}

async function attachLogs(client: SupabaseClient, userId: string, rows: Omit<Habit, 'logs'>[], day: string, signal: AbortSignal): Promise<Habit[]> {
  const days = recentHabitDays(day)
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)
  const { data, error } = await client.from('shidoroku_habit_logs').select(logColumns).eq('user_id', userId)
    .in('habit_id', ids).gte('log_date', days[0]).lte('log_date', day)
    .order('log_date', { ascending: false }).abortSignal(signal).limit(rows.length * 7 + 1)
  if (error || !Array.isArray(data) || data.length > rows.length * 7 || !data.every(row =>
    row && typeof row === 'object' && ids.includes(row.habit_id) && isLog(row, userId, row.habit_id) && days.includes(row.log_date))) throw new Error('Habit log read failed')
  if (new Set(data.map(row => `${row.habit_id}:${row.log_date}`)).size !== data.length) throw new Error('Duplicate habit logs')
  return rows.map(row => ({ ...row, logs: data.filter(log => log.habit_id === row.id) as HabitLog[] }))
}

export async function listHabits(client: SupabaseClient, userId: string, offset: number, day: string, signal: AbortSignal) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !isGoalDate(day)) throw new Error('Invalid habit request')
  const { data, error } = await client.from('shidoroku_habits').select(columns).eq('user_id', userId)
    .order('created_at', { ascending: false }).order('id', { ascending: true }).abortSignal(signal).range(offset, offset + habitsPageSize)
  if (error || !Array.isArray(data) || !data.every(row => isHabitRow(row, userId))) throw new Error('Habit list failed')
  return { habits: await attachLogs(client, userId, data.slice(0, habitsPageSize), day, signal), hasMore: data.length > habitsPageSize }
}

export async function readHabit(client: SupabaseClient, userId: string, id: string, day: string, signal: AbortSignal): Promise<Habit | null> {
  if (!uuid.test(id) || !isGoalDate(day)) throw new Error('Invalid habit request')
  const { data, error } = await client.from('shidoroku_habits').select(columns).eq('user_id', userId).eq('id', id).abortSignal(signal).maybeSingle()
  if (error || (data !== null && (!isHabitRow(data, userId) || data.id !== id))) throw new Error('Habit read failed')
  return data ? (await attachLogs(client, userId, [data], day, signal))[0] : null
}

export async function saveHabit(client: SupabaseClient, userId: string, id: string, input: HabitInput, previous: Habit | null, signal: AbortSignal): Promise<Habit> {
  const { value, error: validationError } = validateHabit(input)
  if (validationError || !uuid.test(id) || (previous && (previous.id !== id || previous.user_id !== userId))) throw new Error('Invalid habit input')
  const table = client.from('shidoroku_habits')
  const query = previous ? table.update(value).eq('user_id', userId).eq('id', id).eq('updated_at', previous.updated_at)
    : table.insert({ id, user_id: userId, ...value })
  const { data, error } = await query.select(columns).abortSignal(signal).maybeSingle()
  if (error || !isHabitRow(data, userId) || data.id !== id || data.name !== value.name || data.note !== value.note || data.status !== value.status) throw new Error('Habit save not confirmed')
  return { ...data, logs: previous?.logs ?? [] }
}

export async function recordHabit(client: SupabaseClient, userId: string, habit: Habit, day: string, signal: AbortSignal): Promise<HabitLog> {
  if (habit.user_id !== userId || !uuid.test(habit.id) || habit.status !== 'active' || !isGoalDate(day)) throw new Error('Invalid habit log request')
  const { data, error } = await client.from('shidoroku_habit_logs').insert({ habit_id: habit.id, user_id: userId, log_date: day })
    .select(logColumns).abortSignal(signal).maybeSingle()
  if (error || !isLog(data, userId, habit.id) || data.log_date !== day) throw new Error('Habit recording not confirmed')
  return data
}

export async function undoHabitLog(client: SupabaseClient, userId: string, habitId: string, day: string, previous: HabitLog, signal: AbortSignal) {
  if (!uuid.test(habitId) || !isLog(previous, userId, habitId) || previous.log_date !== day || !isGoalDate(day)) throw new Error('Invalid habit undo request')
  const { data, error } = await client.from('shidoroku_habit_logs').delete().eq('user_id', userId)
    .eq('habit_id', habitId).eq('log_date', day).eq('completed_at', previous.completed_at)
    .select(logColumns).abortSignal(signal).maybeSingle()
  if (error || !isLog(data, userId, habitId) || data.log_date !== day || data.completed_at !== previous.completed_at) throw new Error('Habit undo not confirmed')
}
