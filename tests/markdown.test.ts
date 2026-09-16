import { describe, expect, it } from 'vitest'
import {
  countWords,
  estimateTokens,
  parseDocument,
  parsePlainText,
  splitMarkdownSections
} from '@main/ingestion/markdown'

const SAMPLE = `---
title: API
draft: false
---

Intro paragraph before any heading.

# API reference

Prefix is /api/v1.

## GET /me

Returns the authenticated user.

### Errors

401 when the token is missing.

## POST /login

Exchanges credentials.

\`\`\`md
# not a heading, it is inside a fence
\`\`\`

Done.
`

describe('markdown section splitter', () => {
  const sections = splitMarkdownSections(SAMPLE, '04-api-reference.md')

  it('keeps the preamble as its own section named after the file', () => {
    expect(sections[0]?.heading).toBe('Api reference')
    expect(sections[0]?.content).toContain('Intro paragraph')
  })

  it('splits on natural headings, not on a character count', () => {
    expect(sections.map((s) => s.heading)).toEqual([
      'Api reference',
      'API reference',
      'GET /me',
      'Errors',
      'POST /login'
    ])
  })

  it('builds the heading path from the heading hierarchy', () => {
    const errors = sections.find((s) => s.heading === 'Errors')
    expect(errors?.headingPath).toBe('API reference > GET /me > Errors')
    expect(errors?.level).toBe(3)
  })

  it('ignores headings inside fenced code blocks', () => {
    const login = sections.find((s) => s.heading === 'POST /login')
    expect(login?.content).toContain('# not a heading')
    expect(sections.some((s) => s.heading.includes('not a heading'))).toBe(false)
  })

  it('records line numbers that point back into the file', () => {
    const lines = SAMPLE.split('\n')
    const me = sections.find((s) => s.heading === 'GET /me')
    expect(me).toBeDefined()
    expect(lines[(me as { startLine: number }).startLine - 1]).toContain('Returns the authenticated user')
  })

  it('skips the YAML frontmatter', () => {
    expect(sections.some((s) => s.content.includes('draft: false'))).toBe(false)
  })

  it('supports setext headings', () => {
    const parsed = splitMarkdownSections('Overview\n========\n\nbody text\n', 'x.md')
    expect(parsed[0]?.heading).toBe('Overview')
    expect(parsed[0]?.level).toBe(1)
  })

  it('never emits empty sections', () => {
    const parsed = splitMarkdownSections('# A\n\n## B\n\ncontent\n', 'x.md')
    expect(parsed.map((s) => s.heading)).toEqual(['B'])
  })

  it('falls back to paragraph chunking only when a section is oversized', () => {
    const paragraph = `${'word '.repeat(200)}\n\n`
    const parsed = splitMarkdownSections(`# Big\n\n${paragraph.repeat(6)}`, 'big.md', { maxSectionTokens: 300 })
    expect(parsed.length).toBeGreaterThan(1)
    expect(parsed.every((s) => s.heading.startsWith('Big'))).toBe(true)
    expect(parsed[1]?.heading).toMatch(/part 2/)
  })
})

describe('plain text parsing', () => {
  it('produces one section for a short file', () => {
    const sections = parsePlainText('just some notes\nsecond line', 'notes.txt')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.heading).toBe('Notes')
  })

  it('dispatches by extension', () => {
    expect(parseDocument('docs/a.md', '# H\n\nbody')[0]?.heading).toBe('H')
    expect(parseDocument('docs/a.txt', '# H\n\nbody')[0]?.heading).toBe('A')
  })
})

describe('counters', () => {
  it('counts technical tokens as words', () => {
    expect(countWords('GET /me returns USER_ID')).toBe(4)
  })

  it('estimates tokens from length', () => {
    expect(estimateTokens('12345678')).toBe(2)
  })
})
