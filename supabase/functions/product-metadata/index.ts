import { createClient } from 'npm:@supabase/supabase-js@2'
import { safeFetchHtml } from '../_shared/safeFetch.ts'
import { handleProductMetadata } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Resolves every A and AAAA record; throws when the name does not exist at all. */
async function resolveAll(hostname: string): Promise<string[]> {
  const [v4, v6] = await Promise.all([
    Deno.resolveDns(hostname, 'A').catch(() => [] as string[]),
    Deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[]),
  ])
  const addresses = [...v4, ...v6]
  if (addresses.length === 0) throw new Error('no addresses')
  return addresses
}

Deno.serve((request) =>
  handleProductMetadata(request, {
    // Verified against the auth server on every call, so the project's JWT signing setup
    // (legacy or asymmetric keys) does not matter. Anonymous sign-ins are rejected.
    async authenticate(req) {
      const header = req.headers.get('Authorization') ?? ''
      if (!header.startsWith('Bearer ')) return null
      const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: header } },
      })
      const { data, error } = await client.auth.getUser(header.slice('Bearer '.length))
      if (error || !data.user || data.user.is_anonymous) return null
      return { userId: data.user.id }
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
    fetchPage: (pageUrl) =>
      safeFetchHtml(pageUrl, { resolve: resolveAll, fetch: (input, init) => fetch(input, init) }),
    log: (message) => console.error(message),
  }),
)
