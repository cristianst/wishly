import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8')
const functions = readdirSync(resolve(root, 'supabase/functions'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)

function verifyJwt(name: string): boolean | undefined {
  const section = new RegExp(`^\\[functions\\.${name}\\]\\s*\\n((?:(?!\\[).*\\n?)*)`, 'm').exec(
    config,
  )
  const match = /^\s*verify_jwt\s*=\s*(true|false)/m.exec(section?.[1] ?? '')
  return match ? match[1] === 'true' : undefined
}

describe('Edge Function deployment settings (supabase/config.toml)', () => {
  it('finds every function', () => {
    expect(functions.sort()).toEqual([
      'product-metadata',
      'public-wishlist',
      'reservation-ownership',
      'reservations',
    ])
  })

  it.each(functions)(
    '%s states its JWT verification explicitly (never an accidental default)',
    (name) => {
      expect(
        verifyJwt(name),
        `[functions.${name}] needs an explicit verify_jwt`,
      ).not.toBeUndefined()
    },
  )

  it('keeps the gateway JWT check off only where the function authenticates callers itself', () => {
    // Guests are not signed in, so public-wishlist, reservations and reservation-ownership must accept
    // anonymous calls (authorization = the share token / reservation secret). product-metadata
    // verifies the creator's session inside the function, which works with every JWT key type.
    for (const name of functions) expect(verifyJwt(name)).toBe(false)
  })
})
