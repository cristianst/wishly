import axe from 'axe-core'

/**
 * Runs axe-core against a rendered subtree and returns readable violations.
 * jsdom has no layout engine, so colour contrast cannot be computed here; it is checked by hand
 * against the palette instead (see docs/SETUP.md, "Accessibility").
 */
export async function a11yViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.html.slice(0, 160)}`).join('\n'),
  )
}
