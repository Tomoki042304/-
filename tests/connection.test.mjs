import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSupabaseConnection } from '../src/lib/checkSupabaseConnection.ts'

const configuration = {
  status: 'configured',
  url: 'https://imgearpizizqkutzrpuz.supabase.co',
  publishableKey: 'sb_publishable_local_test_placeholder',
}

test('connection check sends only a read-only settings request with no session credentials', async () => {
  let calls = 0
  const result = await checkSupabaseConnection(configuration, async (url, options) => {
    calls++
    assert.equal(url, configuration.url + '/auth/v1/settings')
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.deepEqual(options.headers, { apikey: configuration.publishableKey })
    assert.equal(options.body, undefined)
    return Response.json({ external: { email: true } })
  })
  assert.equal(calls, 1)
  assert.equal(result.status, 'success')
  assert.equal(JSON.stringify(result).includes(configuration.publishableKey), false)
})

test('missing settings and unrelated hosts cause no requests', async () => {
  for (const config of [
    { status: 'missing', message: 'Missing settings' },
    { ...configuration, url: 'https://ebozxwiuujrnvmxienat.supabase.co' },
    { ...configuration, publishableKey: 'sb_secret_test' },
  ]) {
    const result = await checkSupabaseConnection(config, async () => { throw Error('Must not request') })
    assert.equal(result.status, 'configuration-error')
  }
})

test('rejects HTTP failures, unexpected JSON, and non-JSON responses', async () => {
  for (const [response, status] of [
    [new Response('Do not display response body', { status: 401 }), 'http-error'],
    [Response.json({}), 'invalid-response'],
    [new Response('<html>error</html>'), 'invalid-response'],
  ]) {
    const result = await checkSupabaseConnection(configuration, async () => response)
    assert.equal(result.status, status)
    assert.equal(result.message.includes('Do not display'), false)
  }
})

test('reports network failures without exposing exception details', async () => {
  const result = await checkSupabaseConnection(configuration, async () => {
    throw Error(configuration.publishableKey)
  })
  assert.equal(result.status, 'network-error')
  assert.equal(result.message.includes(configuration.publishableKey), false)
})

test('aborts a stalled request and reports a timeout', async () => {
  const result = await checkSupabaseConnection(configuration, (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')))), 10)
  assert.equal(result.status, 'timeout')
})
