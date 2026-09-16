import type { Intent, QueryAnalysis } from '@shared/types'
import { extractKeywords, extractSymbols, type ExtractedSymbol } from './symbols'

interface IntentRule {
  intent: Intent
  patterns: RegExp[]
}

/** Order matters: the first rule that fires wins. */
const INTENT_RULES: IntentRule[] = [
  {
    intent: 'bug_investigation',
    patterns: [
      /\bbugs?\b/i,
      /\bissue\b/i,
      /\bregression\b/i,
      /\bsbagliat/i,
      /\bnon funziona\b/i,
      /\bnon torna\b/i,
      /\brotto\b/i,
      /\bbroken\b/i,
      /\bwrong\b/i,
      /\bincorrect\b/i,
      /\bunexpected\b/i,
      /\bsegnalazione\b/i
    ]
  },
  {
    intent: 'error',
    patterns: [
      /\b(?:exception|stack ?trace|traceback)\b/i,
      /\b[A-Z][A-Za-z0-9]*(?:Exception|Error)\b/,
      /\bHTTP[\s/]?[45]\d{2}\b/i,
      /\berrore?\b/i,
      /\bfail(?:s|ed|ing|ure)?\b/i,
      /\bcrash/i
    ]
  },
  {
    intent: 'data_flow',
    patterns: [
      /\bdata ?flow\b/i,
      /\bflusso\b/i,
      /\bpipeline\b/i,
      /\bend[- ]to[- ]end\b/i,
      /\bsequenza\b/i,
      /\bsequence\b/i,
      /\bpassa(?:ggio|no)?\b/i
    ]
  },
  {
    intent: 'dependency',
    patterns: [
      /\bdipend/i,
      /\bdepend/i,
      /\bchi chiama\b/i,
      /\bwho calls\b/i,
      /\bwhich (?:component|service|module)\b/i,
      /\bquale (?:componente|servizio|modulo)\b/i,
      /\buses?\b/i,
      /\busa(?:no)?\b/i,
      /\blibrer/i,
      /\bpackage\b/i
    ]
  },
  {
    intent: 'architecture',
    patterns: [
      /\barchitett/i,
      /\barchitecture\b/i,
      /\bstruttura\b/i,
      /\bstructure\b/i,
      /\boverview\b/i,
      /\bdesign\b/i,
      /\bmodul/i,
      /\blayer/i
    ]
  },
  {
    intent: 'how_it_works',
    patterns: [
      /\bcome funziona\b/i,
      /\bhow (?:does|do|is|are|can)\b/i,
      /\bhow .* works?\b/i,
      /\bin che modo\b/i,
      /\bwhat happens\b/i,
      /\bcosa succede\b/i,
      /\bspiega/i,
      /\bexplain\b/i
    ]
  }
]

export function detectIntent(query: string): Intent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(query))) return rule.intent
  }
  return 'question'
}

export interface AnalysisResult extends QueryAnalysis {
  extracted: ExtractedSymbol[]
}

/**
 * Pure heuristics. The local model is never required to answer a question;
 * it is only ever an optional refinement on top of this.
 */
export function analyzeQuery(query: string): AnalysisResult {
  const trimmed = query.trim()
  const extracted = extractSymbols(trimmed)
  return {
    originalQuery: trimmed,
    symbols: extracted.map((s) => s.value),
    keywords: extractKeywords(trimmed, extracted),
    intent: detectIntent(trimmed),
    extracted
  }
}
