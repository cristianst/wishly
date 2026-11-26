// Extracts product details from a page's HTML. Pure and dependency-free so it runs in Deno and Node.
// Order of trust: schema.org JSON-LD Product > Open Graph > Twitter cards > <title>/meta description.
// Anything not found is simply left out: prices in particular are never guessed.

export type ExtractionStatus = 'success' | 'partial' | 'failed'

export interface ProductMetadata {
  title?: string
  description?: string
  imageUrl?: string
  price?: number
  currency?: string
}

export interface ExtractionResult extends ProductMetadata {
  extractionStatus: ExtractionStatus
  /** True when the page looked like a bot wall or a generic site card, so nothing was trusted. */
  looksBlocked?: true
}

// Limits mirror the database constraints on wishlist_items.
const MAX_TITLE = 150
const MAX_DESCRIPTION = 1000
const MAX_URL = 2048
const MAX_JSON_NODES = 3000
const MAX_DEPTH = 8

// ---------------------------------------------------------------- text

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  copy: '©',
  reg: '®',
  trade: '™',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  deg: '°',
  times: '×',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  ccedil: 'ç',
  iexcl: '¡',
  iquest: '¿',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      if (
        !Number.isFinite(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        return ''
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

function withoutControlCharacters(text: string): string {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : char
  }).join('')
}

/** Plain text only: tags are removed (never kept), entities decoded, whitespace collapsed. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = withoutControlCharacters(decodeEntities(value).replace(/<[^>]{0,2000}>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return undefined
  const chars = Array.from(text)
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

// --------------------------------------------------------------- prices

/**
 * Parses "89.95", "89,95", "1.299,00", "1,299.00", "1299", 89.95. Returns undefined when unsure.
 * A lone separator followed by exactly three digits and a non-zero integer part ("1.299", "1,299")
 * is read as a thousands separator, since prices rarely have three decimals.
 */
export function parsePriceValue(value: unknown): number | undefined {
  let number: number | undefined
  if (typeof value === 'number') {
    number = value
  } else if (typeof value === 'string') {
    if (/^\s*[-\u2212]/.test(value)) return undefined
    const text = value.replace(/[^\d.,]/g, '')
    if (!/\d/.test(text)) return undefined
    const lastDot = text.lastIndexOf('.')
    const lastComma = text.lastIndexOf(',')
    let normalized: string
    if (lastDot >= 0 && lastComma >= 0) {
      const decimal = lastDot > lastComma ? '.' : ','
      const thousands = decimal === '.' ? ',' : '.'
      normalized = text.split(thousands).join('').replace(decimal, '.')
    } else if (lastComma >= 0 || lastDot >= 0) {
      const separator = lastComma >= 0 ? ',' : '.'
      const parts = text.split(separator)
      const last = parts[parts.length - 1]!
      if (parts.length > 2) {
        normalized = parts.join('') // 1.234.567 -> thousands
      } else if (
        last.length === 3 &&
        parts[0] !== '0' &&
        parts[0] !== '' &&
        /^[1-9]\d{0,2}$/.test(parts[0]!)
      ) {
        normalized = parts.join('') // 1.299 / 1,299 -> 1299
      } else {
        normalized = `${parts[0]}.${last}`
      }
    } else {
      normalized = text
    }
    number = Number(normalized)
  }
  if (number === undefined || !Number.isFinite(number) || number < 0 || number >= 1e10)
    return undefined
  return Math.round(number * 100) / 100
}

const parseCurrency = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : undefined

// ---------------------------------------------------------------- URLs

function resolveHttpUrl(candidate: unknown, base: string): string | undefined {
  if (typeof candidate !== 'string') return undefined
  const trimmed = candidate.trim()
  if (trimmed === '' || trimmed.length > MAX_URL) return undefined
  try {
    const url = new URL(decodeEntities(trimmed), base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const text = url.toString()
    return text.length <= MAX_URL ? text : undefined
  } catch {
    return undefined
  }
}

function firstImage(value: unknown, base: string, depth = 0): string | undefined {
  if (depth > 3 || value === null || value === undefined) return undefined
  if (typeof value === 'string') return resolveHttpUrl(value, base)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImage(item, base, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return firstImage(record.url ?? record.contentUrl ?? record['@id'], base, depth + 1)
  }
  return undefined
}

// ---------------------------------------------------------------- HTML

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const pattern = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '')
  for (const match of body.matchAll(pattern)) {
    const name = match[1]!.toLowerCase()
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

const MAX_TAG_LENGTH = 4096

/** Yields every `<tag ...>` of the given name with a linear scan (no backtracking regex). */
function* scanTags(html: string, lower: string, name: string): Generator<string> {
  const opener = `<${name}`
  let cursor = 0
  while (true) {
    const start = lower.indexOf(opener, cursor)
    if (start === -1) return
    const next = lower.charCodeAt(start + opener.length)
    const boundary =
      next === 32 || next === 9 || next === 10 || next === 13 || next === 47 || next === 62
    const end = boundary ? lower.indexOf('>', start) : -1
    if (end === -1) {
      if (boundary) return // no closing '>' anywhere after this point: nothing more to find
      cursor = start + opener.length
      continue
    }
    if (end - start > MAX_TAG_LENGTH) {
      cursor = start + opener.length // implausibly long tag: skip it, keep scanning
      continue
    }
    yield html.slice(start, end + 1)
    cursor = end + 1
  }
}

/** property/name/itemprop -> content (first occurrence wins). */
function collectMeta(html: string, lower: string): Map<string, string> {
  const meta = new Map<string, string>()
  for (const tag of scanTags(html, lower, 'meta')) {
    const attributes = parseAttributes(tag)
    const content = attributes.get('content')
    if (content === undefined) continue
    for (const key of ['property', 'name', 'itemprop']) {
      const label = attributes.get(key)?.trim().toLowerCase()
      if (label && !meta.has(label)) meta.set(label, content)
    }
  }
  return meta
}

function documentTitleOf(html: string, lower: string): string | undefined {
  const start = lower.indexOf('<title')
  if (start === -1) return undefined
  const open = lower.indexOf('>', start)
  const close = open === -1 ? -1 : lower.indexOf('</title', open)
  return close === -1 ? undefined : html.slice(open + 1, close)
}

/** Linear scan (no backtracking regex) for the bodies of <script type="application/ld+json">. */
function collectJsonLdBlocks(html: string, lower: string): unknown[] {
  const blocks: unknown[] = []
  let cursor = 0
  while (blocks.length < 50) {
    const start = lower.indexOf('<script', cursor)
    if (start === -1) break
    const tagEnd = lower.indexOf('>', start)
    if (tagEnd === -1) break
    const end = lower.indexOf('</script', tagEnd)
    cursor = end === -1 ? tagEnd + 1 : end + 8
    const tag = lower.slice(start, tagEnd + 1)
    if (!/type\s*=\s*["']?\s*application\/ld\+json/.test(tag) || end === -1) continue

    let text = html.slice(tagEnd + 1, end).trim()
    text = text.replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\/$/, '')
    text = text
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .replace(/^<!--/, '')
      .replace(/-->$/, '')
      .trim()
    for (const candidate of [text, decodeEntities(text)]) {
      try {
        blocks.push(JSON.parse(candidate))
        break
      } catch {
        // malformed JSON-LD is common; the next source (Open Graph, …) covers it
      }
    }
  }
  return blocks
}

// ------------------------------------------------------------- JSON-LD

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function hasType(node: JsonObject, ...wanted: string[]): boolean {
  const type = node['@type']
  const types = Array.isArray(type) ? type : [type]
  return types.some((t) => typeof t === 'string' && wanted.includes(t))
}

/** Finds Product / ProductGroup nodes anywhere in arrays, @graph and nesting (bounded). */
function findProducts(root: unknown): JsonObject[] {
  const products: JsonObject[] = []
  let visited = 0
  const walk = (value: unknown, depth: number) => {
    if (visited++ > MAX_JSON_NODES || depth > MAX_DEPTH) return
    if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1))
    if (!isObject(value)) return
    if (hasType(value, 'Product', 'ProductGroup', 'IndividualProduct')) products.push(value)
    if (value['@graph']) walk(value['@graph'], depth + 1)
    if (value.mainEntity) walk(value.mainEntity, depth + 1)
    if (value.itemListElement) walk(value.itemListElement, depth + 1)
  }
  walk(root, 0)
  return products
}

interface PriceInfo {
  prices: number[]
  currencies: string[]
}

function collectOfferPrices(offers: unknown, into: PriceInfo, depth = 0): void {
  if (depth > 4 || offers === null || offers === undefined) return
  if (Array.isArray(offers))
    return offers.forEach((offer) => collectOfferPrices(offer, into, depth + 1))
  if (!isObject(offers)) return

  const direct = parsePriceValue(offers.price) ?? parsePriceValue(offers.lowPrice)
  const spec = offers.priceSpecification
  const specs = Array.isArray(spec) ? spec : [spec]
  const specPrice = specs
    .map((s) => (isObject(s) ? parsePriceValue(s.price) : undefined))
    .find((p) => p !== undefined)
  const price = direct ?? specPrice
  if (price !== undefined) into.prices.push(price)

  const currency =
    parseCurrency(offers.priceCurrency) ??
    specs
      .map((s) => (isObject(s) ? parseCurrency(s.priceCurrency) : undefined))
      .find((c) => c !== undefined)
  if (currency) into.currencies.push(currency)
  if (offers.offers) collectOfferPrices(offers.offers, into, depth + 1)
}

/** A price is reported only when the page states exactly one (not several different) price. */
function priceOf(product: JsonObject): { price?: number; currency?: string } {
  const info: PriceInfo = { prices: [], currencies: [] }
  collectOfferPrices(product.offers, info)
  if (info.prices.length === 0 && product.hasVariant) {
    for (const variant of Array.isArray(product.hasVariant)
      ? product.hasVariant
      : [product.hasVariant]) {
      if (isObject(variant)) collectOfferPrices(variant.offers, info)
    }
  }
  const unique = [...new Set(info.prices)]
  if (unique.length !== 1) return {}
  const currencies = [...new Set(info.currencies)]
  return { price: unique[0]!, ...(currencies.length === 1 ? { currency: currencies[0]! } : {}) }
}

function fromJsonLd(blocks: unknown[], base: string): ProductMetadata {
  for (const product of blocks.flatMap(findProducts)) {
    const title = cleanText(product.name, MAX_TITLE)
    if (!title) continue
    const variants = Array.isArray(product.hasVariant) ? product.hasVariant.filter(isObject) : []
    return {
      title,
      description: cleanText(product.description, MAX_DESCRIPTION),
      imageUrl:
        firstImage(product.image, base) ??
        firstImage(
          variants.map((v) => v.image),
          base,
        ),
      ...priceOf(product),
    }
  }
  return {}
}

// ------------------------------------------------- generic / blocked pages

/** Images that are site chrome (share cards, logos, sprites), never a picture of the product. */
const NON_PRODUCT_IMAGE =
  /(share-icons|previewdoh|\/sprites?[/._-]|favicon|\/logos?[/._-]|[/._-]logo[/._-]|placeholder|no[-_]?image|default[-_]?(image|thumb))/i

/** Titles that interstitials and error pages use instead of a product name. */
const WALL_TITLE =
  /^(robot check|captcha|access denied|just a moment\.*|attention required.*|are you a robot\??|verifying you are human.*|please verify.*|service unavailable|bad request|forbidden|page not found|not found|error|an error occurred|something went wrong|sorry.*|oops.*|(40[0-9]|50[0-9]) .*)$/i

const normalizeName = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Names a site uses for itself: "amazon", "amazonde", "otto", plus og:site_name. */
function siteNames(baseUrl: string, siteName: string | undefined): Set<string> {
  const names = new Set<string>()
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, '')
    names.add(normalizeName(host))
    host.split('.').forEach((label) => label.length > 1 && names.add(normalizeName(label)))
  } catch {
    // an unparseable base URL just means no host-based check
  }
  if (siteName) names.add(normalizeName(siteName))
  names.delete('')
  return names
}

/** A title that merely names the site, or an error/challenge page, says nothing about the product. */
function isGenericTitle(title: string, names: Set<string>): boolean {
  return names.has(normalizeName(title)) || WALL_TITLE.test(title.trim())
}

// ------------------------------------------------------------- Amazon

/** amazon.de, amazon.com, amazon.co.uk, amazon.com.au, … (short links redirect here first). */
const AMAZON_HOST = /(^|\.)amazon\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i

function isAmazon(baseUrl: string): boolean {
  try {
    return AMAZON_HOST.test(new URL(baseUrl).hostname)
  } catch {
    return false
  }
}

/** The opening tag of the element with this id, found by a linear scan. */
function tagWithId(
  html: string,
  lower: string,
  id: string,
): { tag: string; end: number } | undefined {
  const wanted = id.toLowerCase()
  for (const quote of ['"', "'"]) {
    const at = lower.indexOf(`id=${quote}${wanted}${quote}`)
    if (at === -1) continue
    const start = lower.lastIndexOf('<', at)
    const end = lower.indexOf('>', at)
    if (start === -1 || end === -1 || end - start > MAX_TAG_LENGTH) continue
    return { tag: html.slice(start, end + 1), end }
  }
  return undefined
}

/** Largest candidate from Amazon's `data-a-dynamic-image` map of {url: [width, height]}. */
function largestDynamicImage(attribute: string | undefined): string | undefined {
  if (!attribute) return undefined
  try {
    const parsed: unknown = JSON.parse(decodeEntities(attribute))
    if (!isObject(parsed)) return undefined
    let best: { url: string; area: number } | undefined
    for (const [url, size] of Object.entries(parsed)) {
      const [width, height] = Array.isArray(size) ? size : []
      const area = Number(width) * Number(height)
      if (Number.isFinite(area) && (!best || area > best.area)) best = { url, area }
    }
    return best?.url
  } catch {
    return undefined
  }
}

/**
 * Amazon product pages carry only a generic share card in Open Graph (og:title "Amazon", a logo),
 * but the real name and picture are in the page itself. Evidence, not guesswork: observed on live
 * amazon.de pages. Brittle by nature (Amazon can rename ids), so everything falls back to <title>.
 * Prices are deliberately not read from Amazon's markup: a page shows many prices (other sellers,
 * subscriptions), and a wrong price is worse than none.
 */
function fromAmazon(html: string, lower: string, baseUrl: string): ProductMetadata {
  const titleElement = tagWithId(html, lower, 'productTitle')
  let title: string | undefined
  if (titleElement) {
    const close = lower.indexOf('</', titleElement.end)
    if (close !== -1 && close - titleElement.end < 2000) {
      title = cleanText(html.slice(titleElement.end + 1, close), MAX_TITLE)
    }
  }

  const image = tagWithId(html, lower, 'landingImage') ?? tagWithId(html, lower, 'imgBlkFront')
  let imageUrl: string | undefined
  if (image) {
    const attributes = parseAttributes(image.tag)
    imageUrl =
      resolveHttpUrl(attributes.get('data-old-hires'), baseUrl) ??
      resolveHttpUrl(largestDynamicImage(attributes.get('data-a-dynamic-image')), baseUrl) ??
      resolveHttpUrl(attributes.get('src'), baseUrl)
  }
  return { ...(title ? { title } : {}), ...(imageUrl ? { imageUrl } : {}) }
}

// ---------------------------------------------------------------- main

export function extractProductMetadata(html: string, baseUrl: string): ExtractionResult {
  const lower = html.toLowerCase()
  const meta = collectMeta(html, lower)
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = meta.get(key)
      if (value !== undefined && value.trim() !== '') return value
    }
    return undefined
  }

  const ld = fromJsonLd(collectJsonLdBlocks(html, lower), baseUrl)
  const amazon = isAmazon(baseUrl) ? fromAmazon(html, lower, baseUrl) : {}
  const names = siteNames(baseUrl, cleanText(meta.get('og:site_name'), MAX_TITLE))

  // Each field takes the first candidate that is actually about the product, in order of trust.
  // A generic candidate (the shop's own name, an error/challenge title) is skipped, not believed.
  const titleCandidates = [
    cleanText(pick('og:title'), MAX_TITLE),
    cleanText(pick('twitter:title'), MAX_TITLE),
    cleanText(documentTitleOf(html, lower), MAX_TITLE),
  ]
  const title =
    ld.title ??
    amazon.title ??
    titleCandidates.find(
      (candidate) => candidate !== undefined && !isGenericTitle(candidate, names),
    )

  if (title === undefined && titleCandidates.some((candidate) => candidate !== undefined)) {
    // Every title on the page names the SITE or an error: a bot wall or generic card, nothing to trust.
    return { extractionStatus: 'failed', looksBlocked: true }
  }

  const description =
    ld.description ??
    [pick('og:description'), pick('twitter:description'), pick('description')]
      .map((candidate) => cleanText(candidate, MAX_DESCRIPTION))
      .find((candidate) => candidate !== undefined && !isGenericTitle(candidate, names))

  const imageCandidates = [
    ld.imageUrl,
    amazon.imageUrl,
    resolveHttpUrl(pick('og:image:secure_url', 'og:image', 'og:image:url'), baseUrl),
    resolveHttpUrl(pick('twitter:image', 'twitter:image:src'), baseUrl),
  ]
  const imageUrl = imageCandidates.find(
    (candidate) => candidate !== undefined && !NON_PRODUCT_IMAGE.test(candidate),
  )

  let price = ld.price
  let currency = ld.currency
  if (price === undefined) {
    price = parsePriceValue(pick('product:price:amount', 'og:price:amount'))
    currency =
      price === undefined
        ? undefined
        : parseCurrency(pick('product:price:currency', 'og:price:currency'))
  }

  const result: ProductMetadata = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(price !== undefined && currency ? { currency } : {}),
  }
  const found = Object.keys(result).length > 0
  return {
    ...result,
    extractionStatus: !found ? 'failed' : title && imageUrl ? 'success' : 'partial',
  }
}
