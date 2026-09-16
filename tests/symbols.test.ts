import { describe, expect, it } from 'vitest'
import { analyzeQuery, detectIntent } from '@main/retrieval/analyzer'
import { extractKeywords, extractSymbols, symbolParts } from '@main/retrieval/symbols'

const values = (text: string): string[] => extractSymbols(text).map((s) => s.value)

describe('symbol extraction', () => {
  it.each([
    ['Where is GET /me documented?', 'GET /me'],
    ['Where is GET /me documented?', '/me'],
    ['POST /login rate limits', 'POST /login'],
    ['who reads /api/users', '/api/users'],
    ['UserService merges the data', 'UserService'],
    ['UserController is thin', 'UserController'],
    ['call getCurrentUser first', 'getCurrentUser'],
    ['a NullPointerException in the job', 'NullPointerException'],
    ['it answers HTTP 500', 'HTTP 500'],
    ['the USER_ID column', 'USER_ID'],
    ['DATABASE_URL is required', 'DATABASE_URL']
  ])('extracts %j -> %j', (query, expected) => {
    expect(values(query)).toContain(expected)
  })

  it('pulls the route out of an Italian bug report', () => {
    expect(values('Mi hanno aperto un bug sulla /me, restituisce dati sbagliati')).toContain('/me')
  })

  it('strips trailing punctuation from routes', () => {
    expect(values('problema sulla /me.')).toContain('/me')
    expect(values('problema sulla /me.')).not.toContain('/me.')
  })

  it('does not treat ordinary capitalised words as symbols', () => {
    expect(values('Mi hanno aperto un bug')).toEqual([])
  })

  it('does not treat "and/or" as a route', () => {
    expect(values('and/or something')).not.toContain('/or')
  })

  it('splits compound symbols into searchable parts', () => {
    expect(symbolParts('/api/users')).toEqual(['api', 'users'])
    expect(symbolParts('getCurrentUser')).toEqual(['get', 'current', 'user'])
  })

  it('removes stopwords and symbol text from the keywords', () => {
    const symbols = extractSymbols('La /me restituisce dati sbagliati')
    expect(extractKeywords('La /me restituisce dati sbagliati', symbols)).toEqual([
      'restituisce',
      'dati',
      'sbagliati'
    ])
  })
})

describe('query analyzer', () => {
  it('produces the documented shape', () => {
    expect(analyzeQuery('La /me restituisce dati sbagliati')).toMatchObject({
      originalQuery: 'La /me restituisce dati sbagliati',
      symbols: ['/me'],
      keywords: ['restituisce', 'dati', 'sbagliati'],
      intent: 'bug_investigation'
    })
  })

  it.each([
    ['Mi hanno aperto un bug: la rotta /me riporta informazioni sbagliate', 'bug_investigation'],
    ['I get a NullPointerException on startup', 'error'],
    ['How does authentication work?', 'how_it_works'],
    ['Describe the architecture of the service', 'architecture'],
    ['Which component calls the external provider?', 'dependency'],
    ['What is the data flow for a login?', 'data_flow'],
    ['Where is the handle stored?', 'question']
  ])('classifies %j as %s', (query, intent) => {
    expect(detectIntent(query)).toBe(intent)
  })
})
