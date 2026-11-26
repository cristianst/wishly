import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSecrets } from '../../../scripts/check-bundle-secrets'

const jwt = (role: string) => {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ iss: 'supabase', role })}.signature_value_12345`
}

function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'))
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

describe('bundle secret scan', () => {
  it('passes for a normal bundle, including the Supabase library’s own key-type check', () => {
    const dir = bundle({
      'assets/supabase.js':
        'const isKey=e=>e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`)',
      'assets/app.js': `const url="https://x.supabase.co",key="sb_publishable_abcdefghijklmnopqrstuvwx"`,
      'index.html': '<script type="module" src="/assets/app.js"></script>',
    })
    expect(findSecrets(dir)).toEqual([])
  })

  it('accepts a legacy anon JWT, which is designed to be public', () => {
    expect(findSecrets(bundle({ 'assets/app.js': `const k="${jwt('anon')}"` }))).toEqual([])
  })

  it('catches a new-style secret key', () => {
    const dir = bundle({
      'assets/app.js': 'const k="sb_secret_abcdefghijklmnopqrstuvwxyz0123456789"',
    })
    expect(findSecrets(dir)).toEqual([
      { file: join(dir, 'assets/app.js'), kind: 'Supabase secret key (sb_secret_…)' },
    ])
  })

  it.each(['service_role', 'supabase_admin', 'postgres'])(
    'catches a legacy JWT with role %s',
    (role) => {
      const findings = findSecrets(
        bundle({ 'assets/app.js': `fetch(url,{headers:{apikey:"${jwt(role)}"}})` }),
      )
      expect(findings).toHaveLength(1)
      expect(findings[0]!.kind).toContain(role)
    },
  )

  it('looks in every shipped file type, including nested folders and source maps', () => {
    const secret = 'sb_secret_abcdefghijklmnopqrstuvwxyz0123456789'
    for (const name of ['assets/deep/a.js', 'index.html', 'assets/app.js.map', 'config.json']) {
      expect(findSecrets(bundle({ [name]: secret })), name).toHaveLength(1)
    }
  })
})
