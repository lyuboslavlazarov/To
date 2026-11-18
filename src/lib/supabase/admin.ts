import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Клиент със service role ключ – заобикаля RLS.
 * Използва се САМО на сървъра и само след проверка на правата
 * (покани по имейл, изпращане на известия, cron задачи, публични регистрации).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Липсва SUPABASE_SERVICE_ROLE_KEY')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
