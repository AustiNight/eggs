import { createClient } from '@supabase/supabase-js'

export function getSupabase(url: string, serviceKey: string) {
  return createClient(url, serviceKey, {
    auth: { persistSession: false }
  })
}
