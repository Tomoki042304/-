import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readProfile, saveProfile, validateDisplayName } from '../src/lib/profile.ts'

const profile = {
  user_id: 'user-a', display_name: '志動録',
  created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T01:00:00Z',
}
const signal = new AbortController().signal
function mockClient(response) {
  const calls = []
  const query = {}
  for (const method of ['from', 'select', 'eq', 'insert', 'update', 'abortSignal']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query }
  }
  query.maybeSingle = async () => response
  return { client: query, calls }
}

test('display names are trimmed, required, and limited to 80 Unicode characters', () => {
  assert.deepEqual(validateDisplayName('  山田 太郎  '), { name: '山田 太郎', error: null })
  assert.ok(validateDisplayName(' \n ').error)
  assert.equal(validateDisplayName('😀'.repeat(80)).error, null)
  assert.ok(validateDisplayName('😀'.repeat(81)).error)
})

test('reads only the current user profile and distinguishes no row from read failure', async () => {
  const { client, calls } = mockClient({ data: profile, error: null })
  assert.deepEqual(await readProfile(client, 'user-a', signal), profile)
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-a'))
  assert.equal(await readProfile(mockClient({ data: null, error: null }).client, 'user-a', signal), null)
  await assert.rejects(readProfile(mockClient({ data: null, error: { message: 'private error' } }).client, 'user-a', signal))
  await assert.rejects(readProfile(mockClient({ data: { ...profile, user_id: 'user-b' }, error: null }).client, 'user-a', signal))
})

test('first save inserts only the owner and normalized display name', async () => {
  const { client, calls } = mockClient({ data: profile, error: null })
  assert.deepEqual(await saveProfile(client, 'user-a', '  志動録  ', null, signal), profile)
  assert.deepEqual(calls.find(call => call[0] === 'insert'), ['insert', { user_id: 'user-a', display_name: '志動録' }])
  assert.equal(calls.some(call => call[0] === 'update'), false)
})

test('subsequent save updates only display_name and compares the last read timestamp', async () => {
  const { client, calls } = mockClient({ data: profile, error: null })
  await saveProfile(client, 'user-a', '志動録', profile, signal)
  assert.deepEqual(calls.find(call => call[0] === 'update'), ['update', { display_name: '志動録' }])
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'updated_at' && call[2] === profile.updated_at))
})

test('zero rows, conflicts, foreign records, and invalid input never report a successful save', async () => {
  for (const response of [
    { data: null, error: null },
    { data: null, error: { code: '23505' } },
    { data: { ...profile, user_id: 'user-b' }, error: null },
    { data: { ...profile, display_name: 'different' }, error: null },
  ]) await assert.rejects(saveProfile(mockClient(response).client, 'user-a', '志動録', profile, signal))
  const { client, calls } = mockClient({ data: profile, error: null })
  await assert.rejects(saveProfile(client, 'user-a', ' ', null, signal))
  await assert.rejects(saveProfile(client, 'user-b', '志動録', profile, signal))
  assert.equal(calls.length, 0)
})
