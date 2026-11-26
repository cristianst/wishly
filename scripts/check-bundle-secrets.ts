// Fails when a Supabase SECRET key ends up in the files shipped to browsers.
//
//   node scripts/check-bundle-secrets.ts dist
//
// It looks for real key shapes, not words: the Supabase client library itself contains the text
// "sb_secret_" (it uses it to recognise key types), so a plain grep would always trip.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Finding {
  file: string
  kind: string
}

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{20,}/g
const JWT = /eyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]{5,}/g
const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin', 'postgres'])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

function roleOf(jwt: string): string | undefined {
  try {
    const payload = jwt.split('.')[1] ?? ''
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    )
    const role: unknown = (JSON.parse(json) as { role?: unknown }).role
    return typeof role === 'string' ? role : undefined
  } catch {
    return undefined
  }
}

export function findSecrets(dir: string): Finding[] {
  const findings: Finding[] = []
  for (const file of walk(dir)) {
    if (!/\.(js|mjs|css|html|json|map|txt)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    if (SECRET_KEY.test(text)) findings.push({ file, kind: 'Supabase secret key (sb_secret_…)' })
    SECRET_KEY.lastIndex = 0
    for (const match of text.matchAll(JWT)) {
      const role = roleOf(match[0])
      if (role && PRIVILEGED_ROLES.has(role))
        findings.push({ file, kind: `JWT with privileged role "${role}"` })
    }
  }
  return findings
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = process.argv[2] ?? 'dist'
  const findings = findSecrets(dir)
  if (findings.length > 0) {
    console.error(`SECRET KEY FOUND in the browser bundle (${dir}):`)
    for (const f of findings) console.error(`  ${f.file}: ${f.kind}`)
    process.exit(1)
  }
  console.log(`Bundle scan clean: no secret keys in ${dir}.`)
}
