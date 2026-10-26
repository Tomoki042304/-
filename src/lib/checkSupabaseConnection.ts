import { validateSupabaseConfiguration, type SupabaseConfiguration } from './supabase.ts'

export type ConnectionCheckResult = {
  status: 'success' | 'configuration-error' | 'timeout' | 'network-error' | 'http-error' | 'invalid-response'
  message: string
}

export async function checkSupabaseConnection(
  configuration: SupabaseConfiguration,
  request: typeof fetch = fetch,
  timeoutMs = 10000,
): Promise<ConnectionCheckResult> {
  if (configuration.status !== 'configured') {
    return { status: 'configuration-error', message: configuration.message }
  }
  // Revalidate at the request boundary: never send a key to an unrelated host.
  const validated = validateSupabaseConfiguration(configuration.url, configuration.publishableKey)
  if (validated.status !== 'configured') {
    return { status: 'configuration-error', message: validated.message }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(`${validated.url}/auth/v1/settings`, {
      method: 'GET',
      headers: { apikey: validated.publishableKey },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      return { status: 'http-error', message: `接続確認に失敗しました（HTTP ${response.status}）。` }
    }
    // Validate the endpoint response, but never display or retain its settings.
    let settings: unknown
    try {
      settings = await response.json()
    } catch {
      return { status: 'invalid-response', message: '接続先からの応答を確認できませんでした。' }
    }
    if (!settings || typeof settings !== 'object' ||
        !('external' in settings) || !settings.external ||
        typeof settings.external !== 'object' || Array.isArray(settings.external)) {
      return { status: 'invalid-response', message: '接続先からの応答を確認できませんでした。' }
    }
    return { status: 'success', message: 'Supabase Authへの接続を確認できました。ログイン・データ保存は未確認です。' }
  } catch {
    return controller.signal.aborted
      ? { status: 'timeout', message: '接続確認がタイムアウトしました。もう一度お試しください。' }
      : { status: 'network-error', message: '通信できませんでした。ネットワークと接続設定を確認してください。' }
  } finally {
    clearTimeout(timer)
  }
}
