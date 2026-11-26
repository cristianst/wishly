import { createClient } from 'npm:@supabase/supabase-js@2'
import { handlePublicWishlist } from './handler.ts'

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the Edge Functions runtime.
// The service-role key stays on the server and only ever calls the two locked-down functions.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
)

Deno.serve((request) =>
  handlePublicWishlist(request, {
    async getWishlist(token) {
      const { data, error } = await admin.rpc('get_public_wishlist', { p_token: token })
      if (error) throw new Error('get_public_wishlist failed')
      return data
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
