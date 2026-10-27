import assert from 'node:assert/strict'
import { test } from 'node:test'
import { habitInput, listHabits, readHabit, recentHabitDays, recordHabit, saveHabit, todayInTokyo, undoHabitLog, validateHabit } from '../src/lib/habits.ts'

const id = '11111111-1111-4111-8111-111111111111'
const day = '2026-10-27'
const input = { name: '朝の散歩', note: '一歩ずつ\n歩く', status: 'active' }
const row = { id, user_id: 'user-a', ...input, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T01:00:00Z' }
const log = { habit_id: id, user_id: 'user-a', log_date: day, completed_at: '2026-10-27T01:00:00.123456Z' }
const habit = { ...row, logs: [] }
const signal = new AbortController().signal
function mock(responses) {
  const calls = []
  return { calls, client: { from(table) {
    calls.push(['from', table]); const query = {}
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'insert', 'update', 'delete', 'abortSignal']) {
      query[method] = (...args) => { calls.push([method, ...args]); return query }
    }
    for (const method of ['range', 'limit', 'maybeSingle']) query[method] = async (...args) => {
      calls.push([method, ...args]); return responses[table]
    }
    return query
  } } }
}

test('uses Japan midnight and a seven-calendar-day window across month/year boundaries', () => {
  assert.equal(todayInTokyo(new Date('2026-10-26T14:59:59Z')), '2026-10-26')
  assert.equal(todayInTokyo(new Date('2026-10-26T15:00:00Z')), '2026-10-27')
  assert.deepEqual(recentHabitDays('2027-01-03'), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03'])
})

test('requires a name, enforces Unicode limits and statuses, and strips uneditable input fields', () => {
  assert.deepEqual(validateHabit({ ...input, name: ' 朝の散歩 ', user_id: 'other', role: 'admin' }).value, input)
  assert.equal(validateHabit({ ...input, name: '😀'.repeat(120), note: '😀'.repeat(1000) }).error, null)
  for (const invalid of [{ name: ' \n ' }, { name: '😀'.repeat(121) }, { note: '😀'.repeat(1001) }, { status: 'admin' }]) assert.ok(validateHabit({ ...input, ...invalid }).error)
})

test('loads only owner habits and bounded logs for the visible page and recent seven days', async () => {
  const { client, calls } = mock({ shidoroku_habits: { data: [row], error: null }, shidoroku_habit_logs: { data: [log], error: null } })
  assert.deepEqual(await listHabits(client, 'user-a', 0, day, signal), { habits: [{ ...row, logs: [log] }], hasMore: false })
  assert.ok(calls.some(c => c[0] === 'in' && c[1] === 'habit_id' && c[2][0] === id))
  assert.ok(calls.some(c => c[0] === 'gte' && c[1] === 'log_date' && c[2] === '2026-10-21'))
  assert.ok(calls.some(c => c[0] === 'lte' && c[1] === 'log_date' && c[2] === day))
  assert.ok(calls.some(c => c[0] === 'limit' && c[1] === 8))
  const many = Array.from({ length: 21 }, (_, n) => ({ ...row, id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111` }))
  const page = mock({ shidoroku_habits: { data: many, error: null }, shidoroku_habit_logs: { data: [], error: null } })
  const result = await listHabits(page.client, 'user-a', 0, day, signal)
  assert.equal(result.habits.length, 20); assert.equal(result.hasMore, true)
  assert.ok(page.calls.some(c => c[0] === 'limit' && c[1] === 141))
})

test('does not turn missing tables, foreign logs, duplicate dates, or missing habits into false success', async () => {
  for (const logs of [null, [ { ...log, user_id: 'user-b' } ], [ { ...log, habit_id: 'foreign' } ], [ { ...log, log_date: '2026-10-01' } ], [log,log]]) {
    await assert.rejects(listHabits(mock({ shidoroku_habits: { data: [row], error: null }, shidoroku_habit_logs: { data: logs, error: logs === null ? {} : null } }).client, 'user-a', 0, day, signal))
  }
  const { client, calls } = mock({ shidoroku_habits: { data: null, error: null } })
  assert.equal(await readHabit(client, 'user-a', id, day, signal), null)
  assert.equal(calls.filter(c => c[0] === 'from').length, 1)
})

test('saves a stable habit ID and updates only editable fields with timestamp conflict detection', async () => {
  const { client, calls } = mock({ shidoroku_habits: { data: row, error: null } })
  assert.deepEqual(await saveHabit(client, 'user-a', id, input, null, signal), habit)
  assert.deepEqual(calls.find(c => c[0] === 'insert'), ['insert', { id, user_id: 'user-a', ...input }])
  await saveHabit(client, 'user-a', id, input, habit, signal)
  assert.deepEqual(calls.find(c => c[0] === 'update'), ['update', input])
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'updated_at' && c[2] === row.updated_at))
  assert.deepEqual(habitInput(habit), input)
  await assert.rejects(saveHabit(mock({ shidoroku_habits: { data: null, error: null } }).client, 'user-a', id, input, habit, signal))
})

test('records only owner, habit ID, and selected day; rejects paused habits and duplicate conflicts', async () => {
  const { client, calls } = mock({ shidoroku_habit_logs: { data: log, error: null } })
  assert.deepEqual(await recordHabit(client, 'user-a', habit, day, signal), log)
  assert.deepEqual(calls.find(c => c[0] === 'insert'), ['insert', { habit_id: id, user_id: 'user-a', log_date: day }])
  await assert.rejects(recordHabit(client, 'user-a', { ...habit, status: 'paused' }, day, signal))
  await assert.rejects(recordHabit(client, 'user-b', habit, day, signal))
  await assert.rejects(recordHabit(mock({ shidoroku_habit_logs: { data: null, error: { code: '23505' } } }).client, 'user-a', habit, day, signal))
})

test('undo deletes only the exact current-day owner record including its timestamp', async () => {
  const { client, calls } = mock({ shidoroku_habit_logs: { data: log, error: null } })
  await undoHabitLog(client, 'user-a', id, day, log, signal)
  assert.ok(calls.some(c => c[0] === 'delete'))
  for (const [key,value] of Object.entries({ user_id:'user-a', habit_id:id, log_date:day, completed_at:log.completed_at })) {
    assert.ok(calls.some(c => c[0] === 'eq' && c[1] === key && c[2] === value))
  }
  await assert.rejects(undoHabitLog(client, 'user-a', id, day, { ...log, log_date: '2026-10-26' }, signal))
  await assert.rejects(undoHabitLog(mock({ shidoroku_habit_logs: { data: null, error: null } }).client, 'user-a', id, day, log, signal))
})
