import type { RetrievalSettings, RetrievedSection, Source } from '@shared/types'

export interface BuiltContext {
  systemPrompt: string
  prompt: string
  sources: Source[]
  used: RetrievedSection[]
  characters: number
  estimatedTokens: number
  truncated: boolean
}

export const SYSTEM_PROMPT = [
  'You are DocMind, a technical assistant answering strictly from a project documentation excerpt.',
  'Never invent classes, routes, tables, fields or behaviour that are not in the supplied documentation.',
  'Separate what the documentation states from what you are inferring.',
  'Answer in the language of the question.'
].join(' ')

const INSTRUCTIONS = [
  'Answer the question using only the supplied documentation.',
  'Separate facts from hypotheses.',
  'If the documentation does not contain enough information, explicitly say so.',
  'Never invent classes, routes, tables or behavior.',
  'Mention the sources supporting important statements, as [SOURCE n].'
]

const MIN_SECTION_CHARS = 300

export function excerptOf(content: string, length = 240): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length <= length ? flat : `${flat.slice(0, length).trimEnd()}…`
}

/**
 * Turns the selected sections into one compact prompt, respecting the
 * character budget from Settings so a large project can never blow the
 * model's context window.
 */
export function buildContext(
  question: string,
  ranked: RetrievedSection[],
  settings: RetrievalSettings
): BuiltContext {
  const selected = ranked.filter((section) => section.selected)
  const budget = settings.maxContextChars
  const blocks: string[] = []
  const sources: Source[] = []
  const used: RetrievedSection[] = []

  let spent = 0
  let truncated = false

  selected.forEach((section, index) => {
    const header = `[SOURCE ${index + 1}]\nFile: ${section.relativePath}\nHeading: ${section.headingPath}\nLines: ${section.startLine}-${section.endLine}\n\n`
    const remaining = budget - spent - header.length
    if (remaining < MIN_SECTION_CHARS) {
      truncated = true
      section.selected = false
      return
    }

    let body = section.content
    if (body.length > remaining) {
      body = `${body.slice(0, remaining).trimEnd()}\n[... section truncated ...]`
      truncated = true
    }

    const block = `${header}${body}`
    blocks.push(block)
    spent += block.length + 2
    used.push(section)
    sources.push({
      sectionId: section.sectionId,
      documentId: section.documentId,
      filename: section.filename,
      relativePath: section.relativePath,
      heading: section.heading,
      headingPath: section.headingPath,
      startLine: section.startLine,
      endLine: section.endLine,
      relevance: section.score,
      excerpt: excerptOf(section.content)
    })
  })

  const documentation = blocks.length > 0 ? blocks.join('\n\n') : '(no matching documentation was found)'

  const prompt = [
    'QUESTION',
    '',
    question.trim(),
    '',
    'DOCUMENTATION',
    '',
    documentation,
    '',
    'INSTRUCTIONS',
    '',
    ...INSTRUCTIONS.map((line) => `- ${line}`),
    ''
  ].join('\n')

  return {
    systemPrompt: SYSTEM_PROMPT,
    prompt,
    sources,
    used,
    characters: prompt.length,
    estimatedTokens: Math.ceil(prompt.length / 4),
    truncated
  }
}
