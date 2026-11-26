import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) =>
  readFileSync(resolve(__dirname, '../../../.github/workflows', file), 'utf8')
const ci = read('ci.yml')
const deploy = read('deploy.yml')

describe('release rules: branches are tested, only merges to main deploy', () => {
  it('runs CI for every pull request', () => {
    expect(ci).toMatch(/^on:\n {2}pull_request:/m)
  })

  it('deploys only from pushes to main (plus a manual run)', () => {
    const triggers = /^on:\n([\s\S]*?)\n\npermissions:/m.exec(deploy)?.[1] ?? ''
    expect(triggers).toMatch(/push:\n\s+branches: \[main\]/)
    expect(triggers).toContain('workflow_dispatch:')
    expect(triggers).not.toMatch(/pull_request|schedule|pull_request_target|workflow_run/)
  })

  it('refuses a manual run on any ref except main or a tag', () => {
    expect(deploy).toContain(
      "if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/')",
    )
  })

  it('cannot deploy without passing CI and the prod environment', () => {
    expect(deploy).toMatch(/uses: \.\/\.github\/workflows\/ci\.yml/)
    expect(deploy).toMatch(/needs: ci/)
    expect(deploy).toMatch(/environment: prod$/m)
  })

  it('applies migrations before functions, and functions before the frontend, then smoke-tests', () => {
    const order = [
      'supabase db push --remote --yes',
      'supabase functions deploy',
      'npm run build',
      'cloudflare/wrangler-action',
      'scripts/smoke-test.ts',
    ].map((marker) => deploy.indexOf(marker))
    expect(order.every((position) => position > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('never runs deployment steps from a pull request or exposes secrets to forks', () => {
    expect(deploy).not.toContain('pull_request')
    expect(ci).not.toMatch(/\$\{\{\s*secrets\./) // CI never reads secrets, so a PR cannot exfiltrate any
  })
})

describe('deployment guide stays in sync with the workflows', () => {
  const guide = readFileSync(resolve(__dirname, '../../../docs/DEPLOYMENT.md'), 'utf8')
  const used = (kind: 'secrets' | 'vars') => [
    ...new Set(
      [...deploy.matchAll(new RegExp(`\\$\\{\\{\\s*${kind}\\.([A-Z0-9_]+)`, 'g'))].map(
        (m) => m[1]!,
      ),
    ),
  ]

  it('documents every secret the deploy workflow reads', () => {
    const secrets = used('secrets')
    expect(secrets.length).toBeGreaterThan(0)
    for (const name of secrets) expect(guide, `secret ${name}`).toContain(`| Secret | \`${name}\``)
  })

  it('documents every variable the deploy workflow reads', () => {
    const variables = used('vars')
    expect(variables.length).toBeGreaterThan(0)
    for (const name of variables)
      expect(guide, `variable ${name}`).toContain(`| Variable | \`${name}\``)
  })

  it('does not document secrets or variables the workflow no longer uses', () => {
    const documented = [...guide.matchAll(/\| (?:Secret|Variable) \| `([A-Z0-9_]+)`/g)].map(
      (m) => m[1]!,
    )
    const actual = new Set([...used('secrets'), ...used('vars')])
    for (const name of documented)
      expect(actual.has(name), `${name} is documented but unused`).toBe(true)
  })

  it('names the required status checks exactly as CI defines them', () => {
    for (const job of [
      'Lint, types, tests, build',
      'Database (RLS policies and reservation races)',
      'Edge Functions (Deno type check)',
    ]) {
      expect(ci, `CI job "${job}"`).toContain(`name: ${job}`)
      expect(guide, `guide mentions "${job}"`).toContain(job)
    }
  })

  it('ships only one environment', () => {
    expect(guide).not.toMatch(/`preview` environment|environment: preview/)
    expect(deploy.match(/environment:/g)).toHaveLength(1)
  })
})
