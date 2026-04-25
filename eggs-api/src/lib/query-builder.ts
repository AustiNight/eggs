/**
 * Compose a clean product search query from a base ingredient name and
 * user-selected clarification options. Options are prepended as adjectives
 * and sanitized so store search APIs tokenize them correctly.
 */
export function buildSearchQuery(baseName: string, selectedOptions: string[] | undefined | null): string {
  const sanitize = (s: string) => s.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim()
  const cleanBase = sanitize(baseName)
  if (!Array.isArray(selectedOptions) || selectedOptions.length === 0) return cleanBase

  const baseTokens = new Set(cleanBase.toLowerCase().split(/\s+/))
  const prefixTokens: string[] = []
  for (const opt of selectedOptions) {
    const cleaned = sanitize(opt).toLowerCase()
    if (!cleaned) continue
    if (baseTokens.has(cleaned)) continue
    prefixTokens.push(cleaned)
  }
  return prefixTokens.length > 0 ? `${prefixTokens.join(' ')} ${cleanBase}` : cleanBase
}
