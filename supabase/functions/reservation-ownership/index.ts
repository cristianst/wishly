import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleReservationOwnership } from './handler.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
)

Deno.serve((request) =>
  handleReservationOwnership(request, {
    async getOwnedItemIds(shareToken, proofs) {
      const { data, error } = await admin.rpc('reservation_ownership', {
        p_token: shareToken,
        p_proofs: proofs,
      })
      if (error) throw new Error('reservation_ownership failed')
      return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : []
    },
    async checkRateLimit(key, limit, windowSeconds) {
      const { data, error } = await admin.rpc('check_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      })
      if (error) throw new Error('check_rate_limit failed')
      return data === true
    },
    log: (message) => console.error(message),
  }),
)
