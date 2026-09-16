import path from 'node:path'

export interface ParsedSection {
  ordinal: number
  level: number
  heading: string
  headingPath: string
  content: string
  startLine: number
  endLine: number
  tokens: number
}

export interface ParseOptions {
  /** Sections longer than this get split on paragraph boundaries. */
  maxSectionTokens?: number
}

const DEFAULT_MAX_SECTION_TOKENS = 700
const ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const SETEXT = /^(=+|-{2,})\s*$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}_/@.-]+/gu)
  return matches ? matches.length : 0
}

interface RawBlock {
  level: number
  heading: string
  headingPath: string
  lines: string[]
  /** 1-based file line of the first content line held in `lines`. */
  contentStart: number
}

/**
 * Splits Markdown along its natural heading structure. Character-based
 * chunking only ever kicks in as a fallback for oversized sections.
 */
export function splitMarkdownSections(source: string, filename: string, options: ParseOptions = {}): ParsedSection[] {
  const maxTokens = options.maxSectionTokens ?? DEFAULT_MAX_SECTION_TOKENS
  const lines = source.split(/\r?\n/)
  const fallbackHeading = humanizeFilename(filename)

  let cursor = skipFrontmatter(lines)
  let fence: string | null = null

  const blocks: RawBlock[] = []
  const stack: { level: number; title: string }[] = []
  let current: RawBlock = {
    level: 0,
    heading: fallbackHeading,
    headingPath: fallbackHeading,
    lines: [],
    contentStart: cursor + 1
  }

  const pushHeading = (level: number, title: string, contentStart: number): void => {
    blocks.push(current)
    while (stack.length > 0 && (stack[stack.length - 1] as { level: number }).level >= level) stack.pop()
    stack.push({ level, title })
    current = {
      level,
      heading: title,
      headingPath: stack.map((s) => s.title).join(' > '),
      lines: [],
      contentStart
    }
  }

  for (; cursor < lines.length; cursor++) {
    const line = lines[cursor] ?? ''

    const fenceMatch = FENCE.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1] as string
      if (fence === null) fence = marker[0] as string
      else if (marker[0] === fence) fence = null
      current.lines.push(line)
      continue
    }
    if (fence !== null) {
      current.lines.push(line)
      continue
    }

    const atx = ATX.exec(line)
    if (atx) {
      pushHeading((atx[1] as string).length, (atx[2] as string).trim() || fallbackHeading, cursor + 2)
      continue
    }

    const setext = SETEXT.exec(line)
    const previous = current.lines[current.lines.length - 1]
    if (setext && previous !== undefined && previous.trim() !== '') {
      const title = previous.trim()
      current.lines.pop()
      pushHeading((setext[1] as string).startsWith('=') ? 1 : 2, title, cursor + 2)
      continue
    }

    current.lines.push(line)
  }
  blocks.push(current)

  const sections: ParsedSection[] = []
  for (const block of blocks) {
    const body = trimBlankEdges(block.lines)
    if (body.text.trim() === '') continue

    const startLine = block.contentStart + body.leading
    for (const piece of splitOversized(body.text, maxTokens)) {
      const text = piece.text.trim()
      if (text === '') continue
      sections.push({
        ordinal: sections.length,
        level: block.level,
        heading: piece.suffix ? `${block.heading} ${piece.suffix}` : block.heading,
        headingPath: piece.suffix ? `${block.headingPath} ${piece.suffix}` : block.headingPath,
        content: text,
        startLine: startLine + piece.lineOffset,
        endLine: startLine + piece.lineOffset + piece.lineCount - 1,
        tokens: estimateTokens(text)
      })
    }
  }

  return sections
}

export function parsePlainText(source: string, filename: string, options: ParseOptions = {}): ParsedSection[] {
  const maxTokens = options.maxSectionTokens ?? DEFAULT_MAX_SECTION_TOKENS
  const heading = humanizeFilename(filename)
  const body = trimBlankEdges(source.split(/\r?\n/))
  if (body.text.trim() === '') return []

  return splitOversized(body.text, maxTokens).map((piece, index) => ({
    ordinal: index,
    level: 0,
    heading: piece.suffix ? `${heading} ${piece.suffix}` : heading,
    headingPath: piece.suffix ? `${heading} ${piece.suffix}` : heading,
    content: piece.text.trim(),
    startLine: 1 + body.leading + piece.lineOffset,
    endLine: body.leading + piece.lineOffset + piece.lineCount,
    tokens: estimateTokens(piece.text)
  }))
}

export function parseDocument(relativePath: string, source: string, options: ParseOptions = {}): ParsedSection[] {
  const filename = path.basename(relativePath)
  const ext = path.extname(relativePath).toLowerCase()
  if (ext === '.md' || ext === '.mdx') return splitMarkdownSections(source, filename, options)
  return parsePlainText(source, filename, options)
}

/* ------------------------------ helpers ------------------------------- */

function humanizeFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '')
  const cleaned = base.replace(/^\d+[-_.]?/, '').replace(/[-_]+/g, ' ').trim()
  const title = cleaned === '' ? base : cleaned
  return title.charAt(0).toUpperCase() + title.slice(1)
}

function skipFrontmatter(lines: string[]): number {
  if ((lines[0] ?? '').trim() !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') return i + 1
  }
  return 0
}

function trimBlankEdges(lines: string[]): { text: string; leading: number } {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start++
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--
  return { text: lines.slice(start, end).join('\n'), leading: start }
}

interface Piece {
  text: string
  suffix: string
  lineOffset: number
  lineCount: number
}

/**
 * ponytail: paragraph-boundary fallback only — headings stay the primary
 * boundary. Swap for a semantic splitter if oversized prose sections become
 * common.
 */
function splitOversized(text: string, maxTokens: number): Piece[] {
  if (estimateTokens(text) <= maxTokens) {
    return [{ text, suffix: '', lineOffset: 0, lineCount: text.split('\n').length }]
  }

  const lines = text.split('\n')
  const pieces: Piece[] = []
  let buffer: string[] = []
  let bufferStart = 0
  let partIndex = 1

  const flush = (endExclusive: number): void => {
    const body = buffer.join('\n')
    if (body.trim() === '') return
    pieces.push({
      text: body,
      suffix: `(part ${partIndex++})`,
      lineOffset: bufferStart,
      lineCount: endExclusive - bufferStart
    })
    buffer = []
  }

  for (let i = 0; i < lines.length; i++) {
    buffer.push(lines[i] ?? '')
    const isBoundary = (lines[i] ?? '').trim() === ''
    if (isBoundary && estimateTokens(buffer.join('\n')) >= maxTokens) {
      flush(i + 1)
      bufferStart = i + 1
    }
  }
  flush(lines.length)

  return pieces.length > 0 ? pieces : [{ text, suffix: '', lineOffset: 0, lineCount: lines.length }]
}
