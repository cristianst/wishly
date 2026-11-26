import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleReservations, type CancelOutcome, type ReserveOutcome } from './handler.ts'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
)

Deno.serve((request) =>
  handleReservations(request, {
    async reserve(shareToken, itemId, claimHash) {
      const { data, error } = await admin.rpc('reserve_item', {
        p_token: shareToken,
        p_item_id: itemId,
        p_claim_hash: claimHash,
      })
      if (error) throw new Error('reserve_item failed')
      return data as ReserveOutcome
    },
    async cancel(shareToken, itemId, claimHash) {
      const { data, error } = await admin.rpc('cancel_reservation', {
        p_token: shareToken,
        p_item_id: itemId,
        p_claim_hash: claimHash,
      })
      if (error) throw new Error('cancel_reservation failed')
      return data as CancelOutcome
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
