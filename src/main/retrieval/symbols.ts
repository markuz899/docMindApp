export type SymbolKind =
  | 'http'
  | 'route'
  | 'error'
  | 'constant'
  | 'file'
  | 'class'
  | 'function'
  | 'snake'
  | 'quoted'

export interface ExtractedSymbol {
  value: string
  kind: SymbolKind
  weight: number
}

const KIND_WEIGHT: Record<SymbolKind, number> = {
  http: 1,
  route: 1,
  error: 0.95,
  quoted: 0.92,
  constant: 0.9,
  file: 0.88,
  class: 0.85,
  function: 0.8,
  snake: 0.7
}

const PATTERNS: { kind: SymbolKind; regex: RegExp; group?: number }[] = [
  { kind: 'quoted', regex: /[`'"]([A-Za-z_/][\w./{}:$-]{1,60})[`'"]/g, group: 1 },
  { kind: 'http', regex: /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[\w./{}:$-]*/gi },
  { kind: 'error', regex: /\b[A-Z][A-Za-z0-9]*(?:Exception|Error)\b/g },
  { kind: 'error', regex: /\bHTTP[\s/]?[1-5]\d{2}\b/gi },
  { kind: 'constant', regex: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
  { kind: 'file', regex: /\b[\w-]+\.(?:md|mdx|txt|ts|tsx|js|jsx|py|go|java|rb|rs|php|cs|json|ya?ml|sql|toml|env)\b/gi },
  { kind: 'class', regex: /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b/g },
  { kind: 'function', regex: /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g },
  { kind: 'snake', regex: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g }
]

const ROUTE = /\/[A-Za-z_][\w.{}:$-]*(?:\/[\w.{}:$-]+)*/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"`]+$/

/**
 * Pulls the technical identifiers out of a free-form question so that exact
 * matches ("/me", "UserService", "DATABASE_URL") can outrank prose matches.
 */
export function extractSymbols(text: string): ExtractedSymbol[] {
  const found = new Map<string, ExtractedSymbol>()

  const add = (raw: string, kind: SymbolKind): void => {
    const value = raw.trim().replace(TRAILING_PUNCTUATION, '')
    if (value.length < 2) return
    const key = value.toLowerCase()
    const weight = KIND_WEIGHT[kind]
    const previous = found.get(key)
    if (!previous || previous.weight < weight) found.set(key, { value, kind, weight })
  }

  for (const { kind, regex, group } of PATTERNS) {
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const value = group === undefined ? match[0] : match[group]
      if (value === undefined) continue
      add(value, kind)
      if (kind === 'http') {
        const path = /\/[\w./{}:$-]*/.exec(value)
        if (path) add(path[0], 'route')
      }
    }
  }

  ROUTE.lastIndex = 0
  for (const match of text.matchAll(ROUTE)) {
    const index = match.index ?? 0
    const previousChar = index > 0 ? text[index - 1] : ''
    // Skip "and/or" style slashes and protocol separators.
    if (previousChar !== undefined && /[\w:]/.test(previousChar)) continue
    add(match[0], 'route')
  }

  return [...found.values()].sort((a, b) => b.weight - a.weight || b.value.length - a.value.length)
}

const STOPWORDS = new Set([
  // English
  'the','a','an','and','or','but','if','then','than','that','this','these','those','is','are','was','were','be','been',
  'being','to','of','in','on','at','for','with','about','from','into','it','its','as','by','do','does','did','how','what',
  'when','where','which','who','why','can','could','should','would','will','shall','may','might','must','have','has','had',
  'i','we','you','they','he','she','my','our','your','their','me','not','no','yes','there','here','also','just','only',
  // Italian
  'il','lo','la','i','gli','le','un','uno','una','del','dello','della','dei','degli','delle','al','allo','alla','ai','agli',
  'alle','dal','dallo','dalla','dai','dagli','dalle','nel','nello','nella','nei','negli','nelle','sul','sullo','sulla','sui',
  'sugli','sulle','con','per','tra','fra','che','chi','cui','come','dove','quando','perche','perché','cosa','quale','quali',
  'e','ed','o','od','ma','se','non','si','sono','sei','essere','stato','stata','ho','hai','ha','hanno','abbiamo','avete',
  'mi','ti','ci','vi','ne','lo','li','la','le','questo','questa','questi','queste','quello','quella','molto','piu','più',
  'ancora','anche','solo','poi','gia','già','fa','fare','deve','devo','dobbiamo','puo','può','posso','possiamo','un\'','c\'e'
])

/** Content words, minus stopwords and anything already captured as a symbol. */
export function extractKeywords(text: string, symbols: ExtractedSymbol[], limit = 12): string[] {
  const symbolText = symbols.map((s) => s.value.toLowerCase()).join(' ')
  const seen = new Set<string>()
  const keywords: string[] = []

  for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length < 3) continue
    if (STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    if (symbolText.includes(token)) continue
    seen.add(token)
    keywords.push(token)
    if (keywords.length >= limit) break
  }

  return keywords
}

/** Splits a symbol into searchable parts: "/api/users" -> ["api", "users"]. */
export function symbolParts(symbol: string): string[] {
  return symbol
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 3)
}
