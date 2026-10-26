import assert from 'node:assert/strict'
import { test } from 'node:test'
import { goalInput, goalsPageSize, isGoalDate, listGoals, readGoal, saveGoal, validateGoal } from '../src/lib/goals.ts'

const id = '11111111-1111-4111-8111-111111111111'
const input = { title: '夢を実現する', description: '一歩ずつ\n進む', targetDate: '2028-02-29', status: 'in_progress' }
const row = { id, user_id: 'user-a', title: input.title, description: input.description,
  target_date: input.targetDate, status: input.status, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T01:00:00Z' }
const signal = new AbortController().signal
function mock(response) {
  const calls = [], client = {}
  for (const method of ['from', 'select', 'eq', 'insert', 'update', 'order', 'abortSignal']) {
    client[method] = (...args) => { calls.push([method, ...args]); return client }
  }
  client.maybeSingle = async () => response
  client.range = async (...args) => { calls.push(['range', ...args]); return response }
  return { client, calls }
}

test('validates Unicode lengths, required title, allowed status, and optional fields', () => {
  assert.equal(validateGoal(input).error, null)
  assert.equal(validateGoal({ ...input, title: '😀'.repeat(120), description: '😀'.repeat(2000), targetDate: '' }).error, null)
  for (const invalid of [{ title: ' \n ' }, { title: '😀'.repeat(121) }, { description: '😀'.repeat(2001) }, { status: 'admin' }]) {
    assert.ok(validateGoal({ ...input, ...invalid }).error)
  }
  assert.equal(validateGoal({ ...input, title: ' 題名 ', description: ' 補足\n続き ' }).value.description, '補足\n続き')
})

test('validates calendar dates including leap years without timezone conversion', () => {
  for (const date of ['0001-01-01', '2028-02-29', '9999-12-31']) assert.equal(isGoalDate(date), true)
  for (const date of ['0000-01-01', '2027-02-29', '2026-04-31', '2026-13-01', '2026-1-1', '2026-10-27T00:00:00Z']) assert.equal(isGoalDate(date), false)
})

test('lists only the owner with stable ordering and fetches one extra row for pagination', async () => {
  const rows = Array.from({ length: 21 }, (_, n) => ({ ...row, id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111` }))
  const { client, calls } = mock({ data: rows, error: null })
  const result = await listGoals(client, 'user-a', 20, signal)
  assert.equal(result.goals.length, goalsPageSize); assert.equal(result.hasMore, true)
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'user_id' && c[2] === 'user-a'))
  assert.ok(calls.some(c => c[0] === 'range' && c[1] === 20 && c[2] === 40))
  assert.deepEqual(calls.filter(c => c[0] === 'order'), [['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: true }]])
  assert.deepEqual(await listGoals(mock({ data: [], error: null }).client, 'user-a', 0, signal), { goals: [], hasMore: false })
  await assert.rejects(listGoals(client, 'user-a', -1, signal))
})

test('rejects failed lists and foreign or malformed records, and reads exactly one owner goal', async () => {
  for (const response of [{ data: null, error: {} }, { data: [ { ...row, user_id: 'user-b' } ], error: null },
    { data: [ { ...row, target_date: '2026-02-30' } ], error: null }]) {
    await assert.rejects(listGoals(mock(response).client, 'user-a', 0, signal))
  }
  const { client, calls } = mock({ data: row, error: null })
  assert.deepEqual(await readGoal(client, 'user-a', id, signal), row)
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'id' && c[2] === id))
  assert.equal(await readGoal(mock({ data: null, error: null }).client, 'user-a', id, signal), null)
})

test('inserts a stable UUID and editable fields only; blank date becomes null', async () => {
  const { client, calls } = mock({ data: { ...row, target_date: null }, error: null })
  await saveGoal(client, 'user-a', id, { ...input, targetDate: '' }, null, signal)
  assert.deepEqual(calls.find(c => c[0] === 'insert'), ['insert', {
    id, user_id: 'user-a', title: input.title, description: input.description, target_date: null, status: input.status,
  }])
})

test('updates editable fields and requires owner, goal ID, and original timestamp', async () => {
  const { client, calls } = mock({ data: { ...row, status: 'achieved' }, error: null })
  await saveGoal(client, 'user-a', id, { ...input, status: 'achieved' }, row, signal)
  assert.deepEqual(Object.keys(calls.find(c => c[0] === 'update')[1]).sort(), ['description', 'status', 'target_date', 'title'])
  assert.ok(calls.some(c => c[0] === 'eq' && c[1] === 'updated_at' && c[2] === row.updated_at))
  assert.deepEqual(goalInput(row), input)
})

test('does not report success for zero updates, conflicts, foreign IDs, or invalid input', async () => {
  for (const response of [{ data: null, error: null }, { data: null, error: { code: '23505' } },
    { data: { ...row, id: '22222222-2222-4222-8222-222222222222' }, error: null },
    { data: { ...row, user_id: 'user-b' }, error: null }]) {
    await assert.rejects(saveGoal(mock(response).client, 'user-a', id, input, row, signal))
  }
  const { client, calls } = mock({ data: row, error: null })
  await assert.rejects(saveGoal(client, 'user-a', id, { ...input, title: '' }, null, signal))
  await assert.rejects(saveGoal(client, 'user-a', id, input, { ...row, user_id: 'user-b' }, signal))
  assert.equal(calls.length, 0)
})
