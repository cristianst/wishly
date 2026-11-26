// SSRF guards for fetching merchant pages on behalf of a user. Pure functions, no network.

export const MAX_URL_LENGTH = 2048

export type UrlRejection =
  'MALFORMED' | 'SCHEME' | 'CREDENTIALS' | 'PORT' | 'HOST' | 'PRIVATE_ADDRESS'

export type ParsedUrl = { ok: true; url: URL } | { ok: false; reason: UrlRejection }

// ----------------------------------------------------------------- IPv4

function parseIPv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

/** [network, prefix length] for every non-public IPv4 block we refuse to contact. */
const BLOCKED_IPV4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
]

const toInt = (octets: number[]): number =>
  ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0

function isBlockedIPv4(octets: number[]): boolean {
  const value = toInt(octets)
  return BLOCKED_IPV4.some(([network, prefix]) => {
    const base = toInt(parseIPv4(network)!)
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) >>> 0 === (base & mask) >>> 0
  })
}

// ----------------------------------------------------------------- IPv6

/** Expands an IPv6 literal (no brackets, no zone) into eight 16-bit groups, or null. */
function parseIPv6(text: string): number[] | null {
  if (text.includes('%') || !text.includes(':')) return null
  let head = text
  let tailV4: number[] | null = null

  const lastColon = text.lastIndexOf(':')
  const maybeV4 = text.slice(lastColon + 1)
  if (maybeV4.includes('.')) {
    tailV4 = parseIPv4(maybeV4)
    if (!tailV4) return null
    head = `${text.slice(0, lastColon + 1)}0:0`
  }

  const doubleColon = head.split('::')
  if (doubleColon.length > 2) return null
  const toGroups = (part: string): number[] | null => {
    if (part === '') return []
    const groups: number[] = []
    for (const piece of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null
      groups.push(parseInt(piece, 16))
    }
    return groups
  }

  const left = toGroups(doubleColon[0]!)
  const right = doubleColon.length === 2 ? toGroups(doubleColon[1]!) : []
  if (!left || !right) return null

  let groups: number[]
  if (doubleColon.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 1) return null
    groups = [...left, ...Array<number>(missing).fill(0), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) return null

  if (tailV4) {
    groups[6] = (tailV4[0]! << 8) | tailV4[1]!
    groups[7] = (tailV4[2]! << 8) | tailV4[3]!
  }
  return groups
}

const embeddedV4 = (g: number[]): number[] => [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]

function isBlockedIPv6(g: number[]): boolean {
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)

  if (allZero(0, 8)) return true // :: unspecified
  if (allZero(0, 7) && g[7] === 1) return true // ::1 loopback
  if (allZero(0, 5) && g[5] === 0xffff) return isBlockedIPv4(embeddedV4(g)) // ::ffff:a.b.c.d
  if (allZero(0, 6)) return true // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isBlockedIPv4(embeddedV4(g)) // NAT64
  if (g[0] === 0x2002) return true // 6to4: embeds an arbitrary IPv4, refuse
  if ((g[0]! & 0xfe00) === 0x2000 && g[0] === 0x2001 && g[1]! < 0x200) return true // 2001::/23 (Teredo, docs…)
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  if ((g[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return true // multicast
  // Only global unicast 2000::/3 is considered public.
  return (g[0]! & 0xe000) !== 0x2000
}

/** True for anything that is not a public, routable address. Unparseable input is blocked. */
export function isBlockedIp(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, '')
  const v4 = parseIPv4(text)
  if (v4) return isBlockedIPv4(v4)
  const v6 = parseIPv6(text)
  if (v6) return isBlockedIPv6(v6)
  return true
}

const looksLikeIp = (host: string): boolean => parseIPv4(host) !== null || host.includes(':')

// ------------------------------------------------------------------ URLs

const INTERNAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.corp',
  '.intranet',
]

/**
 * Validates a user-supplied product link before any network access.
 * Allows only http(s) on the default ports, without credentials, to public-looking hosts.
 * IP-literal hosts (including decimal/hex/octal tricks, which the URL parser normalises)
 * are checked against the blocklist right here; DNS names are checked after resolution.
 */
export function parseProductUrl(input: string): ParsedUrl {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'MALFORMED' }
  }
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return { ok: false, reason: 'MALFORMED' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'SCHEME' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'CREDENTIALS' }
  if (url.port !== '' && url.port !== '80' && url.port !== '443')
    return { ok: false, reason: 'PORT' }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === '') return { ok: false, reason: 'HOST' }
  if (looksLikeIp(host)) {
    return isBlockedIp(host) ? { ok: false, reason: 'PRIVATE_ADDRESS' } : { ok: true, url }
  }
  if (host === 'localhost' || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: 'HOST' }
  }
  if (!host.includes('.')) return { ok: false, reason: 'HOST' } // single-label names are internal

  url.hash = ''
  return { ok: true, url }
}

/** Every resolved address must be public; one private answer (DNS rebinding trick) rejects all. */
export function areAllAddressesPublic(addresses: string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => !isBlockedIp(address))
}
