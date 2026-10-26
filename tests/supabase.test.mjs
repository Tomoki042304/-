import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSupabaseClient, validateSupabaseConfiguration } from '../src/lib/supabase.ts'

const url = 'https://imgearpizizqkutzrpuz.supabase.co'
// Synthetic value for local tests only; never used for requests.
const key = 'sb_publishable_local_test_placeholder'

test('missing configuration leaves the preparation page usable', () => {
  for (const [u, k] of [[undefined, undefined], [url, ''], ['', key]]) {
    const result = validateSupabaseConfiguration(u, k)
    assert.equal(result.status, 'missing')
    assert.equal(createSupabaseClient(result), null)
  }
})

test('rejects production and unrelated projects, insecure URLs, and lookalike hosts', () => {
  for (const u of [
    'https://ebozxwiuujrnvmxienat.supabase.co',
    'https://other.supabase.co',
    'http://imgearpizizqkutzrpuz.supabase.co',
    url + '.example.com',
    url + '/?token=test',
  ]) {
    const result = validateSupabaseConfiguration(u, key)
    assert.equal(result.status, 'invalid')
    assert.equal(createSupabaseClient(result), null)
  }
})

test('rejects secret keys, legacy JWTs, and malformed values without echoing them', () => {
  for (const k of ['sb_secret_test', 'eyJhbGciOiJIUzI1NiJ9.test.test', 'sb_publishable_', 'sb_publishable_test\n']) {
    const result = validateSupabaseConfiguration(url, k)
    assert.equal(result.status, 'invalid')
    assert.equal(JSON.stringify(result).includes(k), false)
  }
})

test('client initialization performs no network requests or session persistence', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request') }
  let client
  try {
    client = createSupabaseClient(validateSupabaseConfiguration(url, key))
    assert.ok(client)
    await client.auth.initialize()
    assert.equal(client.auth.persistSession, false)
    assert.equal(client.auth.autoRefreshToken, false)
    assert.equal(client.auth.detectSessionInUrl, false)
    assert.equal(client.auth.storageKey, 'shidoroku-dev-auth')
    assert.equal(requests, 0)
  } finally {
    client?.auth.stopAutoRefresh()
    globalThis.fetch = originalFetch
  }
})
