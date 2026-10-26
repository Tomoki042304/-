import { createSupabaseClient, validateSupabaseConfiguration } from './supabase'

export const supabaseConfiguration = validateSupabaseConfiguration(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)

// Initialization alone does not make a request or confirm connectivity.
export const supabase = createSupabaseClient(supabaseConfiguration)
