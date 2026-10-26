import { createClient } from '@supabase/supabase-js'

// This shared project is the previous test environment, never the production candidate.
const developmentUrl = 'https://imgearpizizqkutzrpuz.supabase.co'

export type SupabaseConfiguration =
  | { status: 'missing' | 'invalid'; message: string }
  | { status: 'configured'; url: string; publishableKey: string }

export function validateSupabaseConfiguration(
  url: string | undefined,
  publishableKey: string | undefined,
): SupabaseConfiguration {
  if (!url?.trim() || !publishableKey?.trim()) {
    return { status: 'missing', message: 'Supabaseの接続設定が未登録です。' }
  }

  if (url !== developmentUrl) {
    return { status: 'invalid', message: '開発用Supabaseの接続先を確認してください。' }
  }

  // Accept only the explicitly selected public key type. Never accept server secrets.
  if (publishableKey !== publishableKey.trim() || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    return { status: 'invalid', message: 'Publishable keyの種類・形式を確認してください。' }
  }

  return { status: 'configured', url, publishableKey }
}

export function createSupabaseClient(configuration: SupabaseConfiguration) {
  if (configuration.status !== 'configured') return null

  return createClient(configuration.url, configuration.publishableKey, {
    auth: {
      // Auth is shared with the existing app. Do not read a stored session or URL token.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'shidoroku-dev-auth',
    },
  })
}
