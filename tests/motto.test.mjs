import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMotto, saveMotto, validateMotto } from '../src/lib/motto.ts'

const motto = {
  user_id: 'user-a', content: '志動録',
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

test('motto text are trimmed, required, and limited to 500 Unicode characters', () => {
  assert.deepEqual(validateMotto('  山田 太郎  '), { name: '山田 太郎', error: null })
  assert.ok(validateMotto(' \n ').error)
  assert.equal(validateMotto('😀'.repeat(500)).error, null)
  assert.ok(validateMotto('😀'.repeat(501)).error)
})

test('reads only the current user motto and distinguishes no row from read failure', async () => {
  const { client, calls } = mockClient({ data: motto, error: null })
  assert.deepEqual(await readMotto(client, 'user-a', signal), motto)
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'user-a'))
  assert.equal(await readMotto(mockClient({ data: null, error: null }).client, 'user-a', signal), null)
  await assert.rejects(readMotto(mockClient({ data: null, error: { message: 'private error' } }).client, 'user-a', signal))
  await assert.rejects(readMotto(mockClient({ data: { ...motto, user_id: 'user-b' }, error: null }).client, 'user-a', signal))
})

test('first save inserts only the owner and normalized motto text', async () => {
  const { client, calls } = mockClient({ data: motto, error: null })
  assert.deepEqual(await saveMotto(client, 'user-a', '  志動録  ', null, signal), motto)
  assert.deepEqual(calls.find(call => call[0] === 'insert'), ['insert', { user_id: 'user-a', content: '志動録' }])
  assert.equal(calls.some(call => call[0] === 'update'), false)
})

test('subsequent save updates only content and compares the last read timestamp', async () => {
  const { client, calls } = mockClient({ data: motto, error: null })
  await saveMotto(client, 'user-a', '志動録', motto, signal)
  assert.deepEqual(calls.find(call => call[0] === 'update'), ['update', { content: '志動録' }])
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'updated_at' && call[2] === motto.updated_at))
})

test('zero rows, conflicts, foreign records, and invalid input never report a successful save', async () => {
  for (const response of [
    { data: null, error: null },
    { data: null, error: { code: '23505' } },
    { data: { ...motto, user_id: 'user-b' }, error: null },
    { data: { ...motto, content: 'different' }, error: null },
  ]) await assert.rejects(saveMotto(mockClient(response).client, 'user-a', '志動録', motto, signal))
  const { client, calls } = mockClient({ data: motto, error: null })
  await assert.rejects(saveMotto(client, 'user-a', ' ', null, signal))
  await assert.rejects(saveMotto(client, 'user-b', '志動録', motto, signal))
  assert.equal(calls.length, 0)
})


test('preserves internal line breaks and treats HTML as plain text', async () => {
  const text = '志を言葉にする\n行動で証明する <strong>一歩ずつ</strong>'
  assert.deepEqual(validateMotto('  ' + text + '\n'), { name: text, error: null })
  const row = { ...motto, content: text }
  const { client, calls } = mockClient({ data: row, error: null })
  await saveMotto(client, 'user-a', text, null, signal)
  assert.deepEqual(calls.find(call => call[0] === 'insert')[1], { user_id: 'user-a', content: text })
})
