import {
  areAllAddressesPublic,
  isBlockedIp,
  parseProductUrl,
} from '../../../supabase/functions/_shared/ssrf'

describe('isBlockedIp', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks IPv4 %s', (ip) => expect(isBlockedIp(ip)).toBe(true))

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '11.0.0.1',
    '192.169.0.1',
  ])('allows public IPv4 %s', (ip) => expect(isBlockedIp(ip)).toBe(false))

  it.each([
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '2002:c0a8:0101::1',
    '2001:db8::1',
    '2001::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1ff:fe23:4567:890a',
    'fec0::1',
    'ff02::1',
    '[::1]',
    '::127.0.0.1',
    '100::1',
    '0:0:0:0:0:0:0:1',
  ])('blocks IPv6 %s', (ip) => expect(isBlockedIp(ip)).toBe(true))

  it.each([
    '2606:4700:4700::1111',
    '2a00:1450:4001:81b::200e',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('allows public IPv6 %s', (ip) => expect(isBlockedIp(ip)).toBe(false))

  it.each([
    '',
    'not-an-ip',
    '256.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    '::g',
    ':::',
    '1:2:3:4:5:6:7:8:9',
    'fe80::1%eth0',
  ])('blocks anything unparseable: %j', (value) => expect(isBlockedIp(value)).toBe(true))

  it('requires every resolved address to be public', () => {
    expect(areAllAddressesPublic(['93.184.216.34', '2606:4700::1111'])).toBe(true)
    expect(areAllAddressesPublic(['93.184.216.34', '127.0.0.1'])).toBe(false)
    expect(areAllAddressesPublic([])).toBe(false)
  })
})

describe('parseProductUrl', () => {
  const ok = (input: string) => {
    const parsed = parseProductUrl(input)
    if (!parsed.ok) throw new Error(`expected ok, got ${parsed.reason}`)
    return parsed.url
  }
  const reason = (input: string) => {
    const parsed = parseProductUrl(input)
    return parsed.ok ? 'OK' : parsed.reason
  }

  it('accepts ordinary product links and keeps every query parameter', () => {
    const url = ok(
      'https://www.otto.de/p/some-shirt-C2035964495/?variationId=2035964499#ech=29928335',
    )
    expect(url.search).toBe('?variationId=2035964499')
    expect(url.hash).toBe('') // fragments are never sent to a server
    expect(ok('http://shop.example.com/a?b=1&c=2').search).toBe('?b=1&c=2')
    expect(ok('https://shop.example.com:443/x').hostname).toBe('shop.example.com')
    expect(ok('  https://shop.example.com/x  ').hostname).toBe('shop.example.com')
  })

  it.each([
    ['ftp://shop.example.com/x', 'SCHEME'],
    ['file:///etc/passwd', 'SCHEME'],
    ['javascript:alert(1)', 'SCHEME'],
    ['data:text/html,hi', 'SCHEME'],
    ['gopher://shop.example.com', 'SCHEME'],
    ['https://user:pw@shop.example.com/', 'CREDENTIALS'],
    ['https://user@shop.example.com/', 'CREDENTIALS'],
    ['https://shop.example.com:8080/', 'PORT'],
    ['https://shop.example.com:22/', 'PORT'],
    ['http://shop.example.com:6379/', 'PORT'],
    ['not a url', 'MALFORMED'],
    ['', 'MALFORMED'],
    ['https://', 'MALFORMED'],
    [`https://shop.example.com/${'a'.repeat(2100)}`, 'MALFORMED'],
  ])('rejects %s', (input, expected) => expect(reason(input)).toBe(expected))

  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://0/',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://017700000001/',
    'http://0177.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.0.1/',
    'http://172.16.0.1/',
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'https://[0:0:0:0:0:0:0:1]/',
  ])('blocks private/loopback/metadata address %s', (input) =>
    expect(reason(input)).toBe('PRIVATE_ADDRESS'),
  )

  it.each([
    'http://localhost/',
    'http://LOCALHOST:80/',
    'http://foo.localhost/',
    'http://printer.local/',
    'http://db.internal/',
    'http://intranet/',
    'http://router.lan/',
    'http://x.home.arpa/',
    'http://metadata/',
  ])('blocks internal hostname %s', (input) => expect(reason(input)).toBe('HOST'))

  it('allows public IP literals and trailing-dot hostnames', () => {
    expect(reason('http://93.184.216.34/')).toBe('OK')
    expect(reason('https://[2606:4700:4700::1111]/')).toBe('OK')
    expect(reason('https://shop.example.com./x')).toBe('OK')
  })
})
