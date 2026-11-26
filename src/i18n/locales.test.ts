import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') acc[path] = value
    else Object.assign(acc, flatten(value, path))
    return acc
  }, {})
}

const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort()

const english = flatten(en)

describe.each([
  ['es', es],
  ['de', de],
])('%s locale parity with en', (_name, locale) => {
  const flat = flatten(locale as Tree)

  it('has exactly the same keys', () => {
    expect(Object.keys(flat).sort()).toEqual(Object.keys(english).sort())
  })

  it('has no empty values', () => {
    expect(Object.entries(flat).filter(([, value]) => value.trim() === '')).toEqual([])
  })

  it('uses the same interpolation placeholders', () => {
    for (const [key, value] of Object.entries(english)) {
      expect(placeholders(flat[key] ?? ''), key).toEqual(placeholders(value))
    }
  })
})
