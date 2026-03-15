import { createClient } from '@supabase/supabase-js'
import {
  FALLBACK_SUPABASE_URL,
  FALLBACK_SUPABASE_ANON_KEY,
} from './config'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    String(supabaseUrl).startsWith('http'),
)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
