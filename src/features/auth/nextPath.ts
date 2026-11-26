const NEXT_PATH_KEY = 'wishly:auth-next'
export const DEFAULT_NEXT_PATH = '/dashboard'

/** Accepts only same-origin, in-app paths so a crafted value can never redirect off-site. */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_NEXT_PATH
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_NEXT_PATH
  }
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return DEFAULT_NEXT_PATH
  if (value === '/login' || value.startsWith('/auth/')) return DEFAULT_NEXT_PATH
  return value
}

export function rememberNextPath(path: string): void {
  try {
    window.localStorage.setItem(NEXT_PATH_KEY, sanitizeNextPath(path))
  } catch {
    // Without storage the user simply lands on the default page after signing in.
  }
}

export function consumeNextPath(): string {
  try {
    const stored = window.localStorage.getItem(NEXT_PATH_KEY)
    window.localStorage.removeItem(NEXT_PATH_KEY)
    return sanitizeNextPath(stored)
  } catch {
    return DEFAULT_NEXT_PATH
  }
}
