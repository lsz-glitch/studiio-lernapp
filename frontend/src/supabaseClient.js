import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Hinweis in der Konsole, falls die Env-Variablen fehlen
  console.warn(
    'Supabase ist nicht konfiguriert. Bitte VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY in .env.local setzen.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

