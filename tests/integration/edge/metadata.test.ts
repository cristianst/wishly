import {
  cleanText,
  decodeEntities,
  extractProductMetadata,
  parsePriceValue,
} from '../../../supabase/functions/_shared/metadata'

const BASE = 'https://www.otto.de/p/adidas-trikot-C2035964495/?variationId=2035964499'
const page = (head: string, body = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`

describe('JSON-LD Product (a synthetic page shaped like a typical shop)', () => {
  it('extracts title, image, description and price', () => {
    const html = page(
      `<title>adidas Trikot | OTTO</title>${ld({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'adidas Performance Fußballtrikot REAL MADRID 26/27 HEIMTRIKOT',
        description: 'Schmale Passform mit Rundhalsausschnitt',
        image: ['https://i.otto.example/img/1.jpg', 'https://i.otto.example/img/2.jpg'],
        offers: { '@type': 'Offer', price: '89.95', priceCurrency: 'EUR' },
      })}`,
    )
    expect(extractProductMetadata(html, BASE)).toEqual({
      title: 'adidas Performance Fußballtrikot REAL MADRID 26/27 HEIMTRIKOT',
      description: 'Schmale Passform mit Rundhalsausschnitt',
      imageUrl: 'https://i.otto.example/img/1.jpg',
      price: 89.95,
      currency: 'EUR',
      extractionStatus: 'success',
    })
  })

  it('finds a Product inside @graph and arrays, ignoring breadcrumbs and organizations', () => {
    const html = page(
      ld([
        { '@type': 'BreadcrumbList', itemListElement: [] },
        {
          '@graph': [
            { '@type': 'Organization', name: 'Shop GmbH' },
            {
              '@type': ['Thing', 'Product'],
              name: 'Lamp',
              image: 'https://x.example/l.png',
              offers: { price: 49, priceCurrency: 'eur' },
            },
          ],
        },
      ]),
    )
    expect(extractProductMetadata(html, BASE)).toMatchObject({
      title: 'Lamp',
      imageUrl: 'https://x.example/l.png',
      price: 49,
      currency: 'EUR',
    })
  })

  it.each([
    ['ImageObject', { '@type': 'ImageObject', url: 'https://x.example/a.jpg' }],
    [
      'array of ImageObjects',
      [{ url: 'https://x.example/a.jpg' }, { url: 'https://x.example/b.jpg' }],
    ],
    ['relative URL', '/media/a.jpg'],
    ['protocol-relative URL', '//x.example/a.jpg'],
  ])('reads an image given as %s', (_name, image) => {
    const html = page(ld({ '@type': 'Product', name: 'P', image }))
    const url = extractProductMetadata(html, 'https://x.example/p').imageUrl
    expect(url).toMatch(/^https:\/\/x\.example\/(media\/)?a\.jpg$/)
  })

  it('handles ProductGroup with variants: uses a price only when every variant agrees', () => {
    const same = ld({
      '@type': 'ProductGroup',
      name: 'Shirt',
      hasVariant: [
        { '@type': 'Product', offers: { price: '20.00', priceCurrency: 'EUR' } },
        { '@type': 'Product', offers: { price: '20', priceCurrency: 'EUR' } },
      ],
    })
    const differ = ld({
      '@type': 'ProductGroup',
      name: 'Shirt',
      hasVariant: [
        { '@type': 'Product', offers: { price: '20.00' } },
        { '@type': 'Product', offers: { price: '25.00' } },
      ],
    })
    expect(extractProductMetadata(page(same), BASE)).toMatchObject({ price: 20, currency: 'EUR' })
    expect(extractProductMetadata(page(differ), BASE).price).toBeUndefined()
  })

  it('reads AggregateOffer and priceSpecification, and omits conflicting offers', () => {
    const agg = ld({
      '@type': 'Product',
      name: 'P',
      offers: { '@type': 'AggregateOffer', lowPrice: '10.50', priceCurrency: 'USD' },
    })
    const spec = ld({
      '@type': 'Product',
      name: 'P',
      offers: { priceSpecification: { price: 7, priceCurrency: 'GBP' } },
    })
    const many = ld({ '@type': 'Product', name: 'P', offers: [{ price: '5' }, { price: '6' }] })
    expect(extractProductMetadata(page(agg), BASE)).toMatchObject({ price: 10.5, currency: 'USD' })
    expect(extractProductMetadata(page(spec), BASE)).toMatchObject({ price: 7, currency: 'GBP' })
    expect(extractProductMetadata(page(many), BASE).price).toBeUndefined()
  })

  it('tolerates malformed JSON-LD and falls back to Open Graph', () => {
    const html = page(
      `<script type="application/ld+json">{ "@type": "Product", "name": "Broken", }</script>
       <meta property="og:title" content="From OG"><meta property="og:image" content="https://x.example/og.jpg">`,
    )
    expect(extractProductMetadata(html, BASE)).toMatchObject({
      title: 'From OG',
      imageUrl: 'https://x.example/og.jpg',
      extractionStatus: 'success',
    })
  })

  it('accepts unusual script attributes and CDATA wrappers', () => {
    const html = page(
      `<SCRIPT data-x="1" TYPE='application/ld+json' id=a>/*<![CDATA[*/{"@type":"Product","name":"Odd"}/*]]>*/</SCRIPT>`,
    )
    expect(extractProductMetadata(html, BASE).title).toBe('Odd')
  })
})

describe('fallbacks', () => {
  it('uses Open Graph with product price tags', () => {
    const html = page(`
      <meta property="og:title" content="OG Title"><meta property="og:description" content="OG desc">
      <meta property="og:image" content="/img/og.png"><meta property="product:price:amount" content="1.299,00">
      <meta property="product:price:currency" content="eur">`)
    expect(extractProductMetadata(html, 'https://shop.example/a/b')).toEqual({
      title: 'OG Title',
      description: 'OG desc',
      imageUrl: 'https://shop.example/img/og.png',
      price: 1299,
      currency: 'EUR',
      extractionStatus: 'success',
    })
  })

  it('falls back to Twitter cards, then <title> and the meta description', () => {
    expect(
      extractProductMetadata(
        page(
          `<meta name="twitter:title" content="Tw"><meta name="twitter:image" content="https://x.example/t.png">`,
        ),
        BASE,
      ),
    ).toMatchObject({ title: 'Tw', imageUrl: 'https://x.example/t.png' })
    expect(
      extractProductMetadata(
        page(`<title> Plain   page\n title </title><meta name="description" content="Plain desc">`),
        BASE,
      ),
    ).toEqual({ title: 'Plain page title', description: 'Plain desc', extractionStatus: 'partial' })
  })

  it('prefers JSON-LD over Open Graph over Twitter', () => {
    const html = page(
      `<meta property="og:title" content="OG"><meta name="twitter:title" content="TW">${ld({ '@type': 'Product', name: 'LD' })}`,
    )
    expect(extractProductMetadata(html, BASE).title).toBe('LD')
    expect(
      extractProductMetadata(
        page(`<meta name="twitter:title" content="TW"><meta property="og:title" content="OG">`),
        BASE,
      ).title,
    ).toBe('OG')
  })

  it('reads attributes in any order and quoting style', () => {
    const html = page(
      `<meta content='Single' property=og:title><meta content=NoQuotes name=description /><META CONTENT="Up" PROPERTY="OG:IMAGE:URL">`,
    )
    expect(extractProductMetadata(html, 'https://x.example/').title).toBe('Single')
  })
})

describe('status and honesty', () => {
  it('reports partial when only some fields are found', () => {
    expect(
      extractProductMetadata(page(`<meta property="og:title" content="Only title">`), BASE)
        .extractionStatus,
    ).toBe('partial')
    expect(
      extractProductMetadata(
        page(`<meta property="og:image" content="https://x.example/i.png">`),
        BASE,
      ).extractionStatus,
    ).toBe('partial')
  })

  it('reports failed for JavaScript-only or empty pages', () => {
    expect(
      extractProductMetadata(
        '<html><body><div id="app"></div><script src="/app.js"></script></body></html>',
        BASE,
      ),
    ).toEqual({ extractionStatus: 'failed' })
    expect(extractProductMetadata('', BASE)).toEqual({ extractionStatus: 'failed' })
  })

  it('never invents a price or currency', () => {
    expect(
      extractProductMetadata(page(`<meta property="og:title" content="T">`), BASE),
    ).not.toHaveProperty('price')
    expect(
      extractProductMetadata(
        page(ld({ '@type': 'Product', name: 'P', offers: { price: 'ab' } })),
        BASE,
      ),
    ).not.toHaveProperty('price')
    expect(
      extractProductMetadata(
        page(ld({ '@type': 'Product', name: 'P', offers: { price: -5 } })),
        BASE,
      ),
    ).not.toHaveProperty('price')
    // A currency without a price is meaningless, so it is dropped too.
    expect(
      extractProductMetadata(page(`<meta property="product:price:currency" content="EUR">`), BASE),
    ).not.toHaveProperty('currency')
  })

  it('omits the currency when the page does not state one', () => {
    expect(
      extractProductMetadata(
        page(ld({ '@type': 'Product', name: 'P', offers: { price: '12.00' } })),
        BASE,
      ),
    ).toMatchObject({ price: 12 })
    expect(
      extractProductMetadata(
        page(ld({ '@type': 'Product', name: 'P', offers: { price: '12.00' } })),
        BASE,
      ),
    ).not.toHaveProperty('currency')
  })
})

describe('safety of extracted values', () => {
  it('drops images that are not http(s) or are oversized', () => {
    for (const image of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'file:///etc/passwd',
      `https://x.example/${'a'.repeat(2100)}`,
    ]) {
      expect(
        extractProductMetadata(page(ld({ '@type': 'Product', name: 'P', image })), BASE).imageUrl,
      ).toBeUndefined()
    }
    expect(
      extractProductMetadata(page(`<meta property="og:image" content="javascript:alert(1)">`), BASE)
        .imageUrl,
    ).toBeUndefined()
  })

  it('returns text only: tags are stripped, never passed through', () => {
    const html = page(
      ld({
        '@type': 'Product',
        name: '<img src=x onerror=alert(1)>Lamp <b>Pro</b>',
        description: '<svg onload=alert(1)>Nice',
      }),
    )
    const result = extractProductMetadata(html, BASE)
    expect(result.title).toBe('Lamp Pro')
    expect(result.description).toBe('Nice')
    expect(JSON.stringify(result)).not.toMatch(/<|>/)
  })

  it('also strips markup that was entity-encoded in the source', () => {
    const html = page(
      ld({
        '@type': 'Product',
        name: '&lt;b&gt;Bold&lt;/b&gt; &lt;img src=x onerror=alert(1)&gt;Lamp',
      }),
    )
    expect(extractProductMetadata(html, BASE).title).toBe('Bold Lamp')
  })

  it('a stray </script> inside JSON-LD ends the block, as in a browser, and falls back safely', () => {
    const html = page(
      `<script type="application/ld+json">{"@type":"Product","name":"X","description":"</script><script>alert(1)</script>"}</script>
       <meta property="og:title" content="Fallback title">`,
    )
    expect(extractProductMetadata(html, BASE)).toMatchObject({ title: 'Fallback title' })
  })

  it('truncates to the database limits without splitting characters', () => {
    const long = '😀'.repeat(400)
    const result = extractProductMetadata(
      page(ld({ '@type': 'Product', name: long, description: long })),
      BASE,
    )
    expect(Array.from(result.title!).length).toBeLessThanOrEqual(150)
    expect(Array.from(result.description!).length).toBeLessThanOrEqual(1000)
    expect(result.title!.endsWith('…')).toBe(true)
  })

  it('is not slow on large or hostile input', () => {
    const started = Date.now()
    extractProductMetadata(`<script type="application/ld+json">${'['.repeat(200_000)}`, BASE)
    extractProductMetadata('<meta '.repeat(100_000), BASE)
    extractProductMetadata('<script type="application/ld+json"'.repeat(5_000), BASE)
    extractProductMetadata(`<title>${'a'.repeat(1_000_000)}`, BASE)
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('text and price helpers', () => {
  it('decodes entities, including German umlauts and numeric forms', () => {
    expect(
      decodeEntities('M&auml;nner &amp; Frauen &#8211; &#x20AC;5 &unknown; &#0; &#xD800;'),
    ).toBe('Männer & Frauen – €5 &unknown;  ')
    expect(cleanText('  a \n\t b  ', 10)).toBe('a b')
    expect(cleanText('', 10)).toBeUndefined()
    expect(cleanText(42, 10)).toBeUndefined()
  })

  it.each([
    ['89.95', 89.95],
    ['89,95', 89.95],
    ['1.299,00', 1299],
    ['1,299.00', 1299],
    ['1299', 1299],
    ['€ 19,99', 19.99],
    ['19.99 EUR', 19.99],
    ['1.299', 1299],
    ['1,299', 1299],
    ['0.999', 1],
    ['1.234.567', 1234567],
    [12.345, 12.35],
    [0, 0],
    ['0,50', 0.5],
  ])('parses %j as %s', (input, expected) => expect(parsePriceValue(input)).toBe(expected))

  it.each(['', 'abc', '-5', -5, NaN, Infinity, '99999999999', null, undefined, {}])(
    'rejects %j',
    (input) => expect(parsePriceValue(input)).toBeUndefined(),
  )
})

describe('generic site cards and bot walls are not product data', () => {
  const AMAZON_SHARE_CARD = page(`
    <title>Amazon.de</title>
    <meta property="og:title" content="amazon">
    <meta property="og:image" content="https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png">`)

  it('rejects the generic Amazon share card (site name + logo image) instead of reporting success', () => {
    expect(extractProductMetadata(AMAZON_SHARE_CARD, 'https://www.amazon.de/dp/B0TEST')).toEqual({
      extractionStatus: 'failed',
      looksBlocked: true,
    })
  })

  it.each([
    ['Robot Check', 'https://www.amazon.de/x'],
    ['Access Denied', 'https://shop.example.com/x'],
    ['Just a moment...', 'https://shop.example.com/x'],
    ['Attention Required! | Cloudflare', 'https://shop.example.com/x'],
    ['503 Service Unavailable', 'https://shop.example.com/x'],
    ['Page not found', 'https://shop.example.com/x'],
    ['OTTO', 'https://www.otto.de/p/x'],
    ['Amazon.de', 'https://www.amazon.de/x'],
    ['Zalando', 'https://www.zalando.de/x'],
  ])('rejects the page title %j as a non-product page', (title, url) => {
    const html = page(
      `<title>${title}</title><meta property="og:image" content="https://cdn.example.com/hero.jpg">`,
    )
    expect(extractProductMetadata(html, url)).toEqual({
      extractionStatus: 'failed',
      looksBlocked: true,
    })
  })

  it('uses og:site_name to recognise a generic card on any shop', () => {
    const html = page(
      `<meta property="og:site_name" content="Super Shop"><meta property="og:title" content="Super Shop"><meta property="og:image" content="https://cdn.example.com/a.jpg">`,
    )
    expect(extractProductMetadata(html, 'https://super-shop-gmbh.example/p/1').looksBlocked).toBe(
      true,
    )
  })

  it('keeps real product titles, even when they mention the shop', () => {
    const html = page(
      `<meta property="og:title" content="Lamp Pro | Amazon.de"><meta property="og:image" content="https://cdn.example.com/lamp.jpg">`,
    )
    expect(extractProductMetadata(html, 'https://www.amazon.de/dp/X')).toMatchObject({
      title: 'Lamp Pro | Amazon.de',
      extractionStatus: 'success',
    })
  })

  it('trusts schema.org Product data even if the name resembles the site', () => {
    const html = page(
      ld({ '@type': 'Product', name: 'Otto', image: 'https://cdn.example.com/o.jpg' }),
    )
    expect(extractProductMetadata(html, 'https://www.otto.de/p/1')).toMatchObject({
      title: 'Otto',
      extractionStatus: 'success',
    })
  })

  it.each([
    'https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png',
    'https://shop.example.com/assets/logo.png',
    'https://shop.example.com/static/logo-dark.svg',
    'https://shop.example.com/img/placeholder.png',
    'https://shop.example.com/img/no-image.jpg',
    'https://shop.example.com/favicon.ico',
    'https://shop.example.com/sprites/all.png',
  ])('drops the non-product image %s but keeps a real title', (image) => {
    const html = page(
      `<meta property="og:title" content="Real Product Name"><meta property="og:image" content="${image}">`,
    )
    const result = extractProductMetadata(html, 'https://shop.example.com/p/1')
    expect(result).toEqual({ title: 'Real Product Name', extractionStatus: 'partial' })
  })

  it('does not treat ordinary product images as chrome', () => {
    const html = page(
      `<meta property="og:title" content="Lamp"><meta property="og:image" content="https://i.example.com/products/catalog/lamp-large.jpg">`,
    )
    expect(extractProductMetadata(html, 'https://shop.example.com/p/1').imageUrl).toBe(
      'https://i.example.com/products/catalog/lamp-large.jpg',
    )
  })

  it('treats a JavaScript challenge page with no title as having no data', () => {
    const html =
      '<html><head></head><body><script>window.KPSDK={};</script><script src="/ips.js"></script></body></html>'
    expect(extractProductMetadata(html, 'https://www.otto.de/p/x')).toEqual({
      extractionStatus: 'failed',
    })
  })
})

describe('Amazon product pages (structure observed on live amazon.de / amazon.co.uk pages)', () => {
  const AMAZON_URL = 'https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM'
  const amazonPage = (
    body: string,
    title = 'Echo Dot (2022 model) smart speaker with Alexa | Charcoal : Amazon.de: Electronics &amp; Photo',
  ) =>
    page(
      `<title>${title}</title>
       <meta name="description" content="Buy Echo Dot (2022 model) smart speaker with Alexa | Charcoal online">
       <meta property="og:title" content="Amazon"/>
       <meta property="og:image" content="https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png"/>
       <meta property="og:description" content="Amazon"/>`,
      body,
    )

  it('reads the real name and picture instead of the generic share card', () => {
    const html = amazonPage(`
      <span id="productTitle" class="a-size-large product-title-word-break">
        Echo Dot (2022 model) smart speaker with Alexa | Charcoal
      </span>
      <img id="landingImage" src="https://m.media-amazon.com/images/I/small._AC_SX200_.jpg"
           data-old-hires="https://m.media-amazon.com/images/I/71QkqMEiAAL._AC_SL1500_.jpg"
           data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/a._SX300_.jpg&quot;:[300,300]}">`)
    expect(extractProductMetadata(html, AMAZON_URL)).toEqual({
      title: 'Echo Dot (2022 model) smart speaker with Alexa | Charcoal',
      description: 'Buy Echo Dot (2022 model) smart speaker with Alexa | Charcoal online',
      imageUrl: 'https://m.media-amazon.com/images/I/71QkqMEiAAL._AC_SL1500_.jpg',
      extractionStatus: 'success',
    })
  })

  it('picks the largest dynamic image when there is no hi-res attribute, and falls back to src', () => {
    const dynamic = amazonPage(`<span id="productTitle">Lamp</span>
      <img id="landingImage" data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/s.jpg&quot;:[100,100],&quot;https://m.media-amazon.com/images/I/big.jpg&quot;:[1500,1500]}">`)
    expect(extractProductMetadata(dynamic, AMAZON_URL).imageUrl).toBe(
      'https://m.media-amazon.com/images/I/big.jpg',
    )
    const plain = amazonPage(
      `<span id="productTitle">Lamp</span><img id="landingImage" src="https://m.media-amazon.com/images/I/only.jpg">`,
    )
    expect(extractProductMetadata(plain, AMAZON_URL).imageUrl).toBe(
      'https://m.media-amazon.com/images/I/only.jpg',
    )
  })

  it('still gets a real title from <title> when the product markup is missing', () => {
    const result = extractProductMetadata(amazonPage('<div>nothing useful</div>'), AMAZON_URL)
    expect(result.title).toBe(
      'Echo Dot (2022 model) smart speaker with Alexa | Charcoal : Amazon.de: Electronics & Photo',
    )
    expect(result.imageUrl).toBeUndefined() // the share-card logo is never used as a product image
    expect(result.extractionStatus).toBe('partial')
  })

  it('never reads a price from the markup, because pages show many prices', () => {
    const html = amazonPage(
      `<span id="productTitle">Lamp</span><span class="a-price"><span class="a-offscreen">€49,99</span></span>`,
    )
    expect(extractProductMetadata(html, AMAZON_URL)).not.toHaveProperty('price')
  })

  it('rejects a genuine robot-check page', () => {
    const html = page(
      `<title>Robot Check</title>`,
      `<form action="/errors/validateCaptcha"></form>`,
    )
    expect(extractProductMetadata(html, 'https://www.amazon.de/dp/X')).toEqual({
      extractionStatus: 'failed',
      looksBlocked: true,
    })
  })

  it('only applies the product-markup reader on Amazon domains', () => {
    const html = page(
      `<title>Other shop</title>`,
      `<span id="productTitle">Hidden decoy</span><img id="landingImage" src="https://evil.example/x.jpg">`,
    )
    const result = extractProductMetadata(html, 'https://shop.example.com/p/1')
    expect(result.title).toBe('Other shop')
    expect(result.imageUrl).toBeUndefined()
  })

  it.each([
    'https://www.amazon.co.uk/dp/X',
    'https://www.amazon.com/dp/X',
    'https://www.amazon.com.au/dp/X',
    'https://smile.amazon.de/dp/X',
  ])('recognises %s', (url) => {
    const html = amazonPage(`<span id="productTitle">Lamp</span>`)
    expect(extractProductMetadata(html, url).title).toBe('Lamp')
  })

  it.each([
    'https://www.notamazon.de/dp/X',
    'https://amazon.evil.example/dp/X',
    'https://www.amazon.de.evil.example/dp/X',
  ])('does not treat look-alike host %s as Amazon', (url) => {
    const html = amazonPage(`<span id="productTitle">Decoy</span>`)
    expect(extractProductMetadata(html, url).title).not.toBe('Decoy')
  })
})

describe('skipping generic candidates instead of giving up', () => {
  it('falls through generic Open Graph tags to a real <title> on any shop', () => {
    const html = page(
      `<title>Garden Chair Oslo - Example Shop</title><meta property="og:site_name" content="Example Shop"><meta property="og:title" content="Example Shop"><meta property="og:image" content="https://cdn.example.com/chair.jpg">`,
    )
    expect(extractProductMetadata(html, 'https://shop.example.com/p/9')).toMatchObject({
      title: 'Garden Chair Oslo - Example Shop',
      imageUrl: 'https://cdn.example.com/chair.jpg',
      extractionStatus: 'success',
    })
  })

  it('falls through a generic description to a specific one', () => {
    const html = page(
      `<title>Chair</title><meta property="og:site_name" content="Example Shop"><meta property="og:description" content="Example Shop"><meta name="description" content="A comfortable oak chair">`,
    )
    expect(extractProductMetadata(html, 'https://shop.example.com/p/9').description).toBe(
      'A comfortable oak chair',
    )
  })
})
