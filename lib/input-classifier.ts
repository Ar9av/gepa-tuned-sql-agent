/**
 * Fast heuristic classifier: is the user asking a SQL query or giving a suggestion/correction?
 *
 * Suggestions trigger GEPA optimization instead of SQL generation.
 * This runs client-side (no LLM call) for instant feedback.
 */

export type InputType = 'query' | 'suggestion'

// Patterns that strongly indicate a suggestion/correction
const SUGGESTION_PATTERNS = [
  /^(use|try|prefer|switch to|change to|replace)\s/i,
  /^(don'?t|do not|never|stop|avoid)\s/i,
  /^(the (column|table|field|result|answer|query|output) (should|is|was|needs))/i,
  /^(it should|this should|that should|should be|should use|should return)/i,
  /^(wrong|incorrect|not right|that'?s wrong|still wrong|nope|no,?\s)/i,
  /^(actually|instead|rather|better to)\s/i,
  /^(add|remove|include|exclude|filter|sort)\s.*(rule|constraint|column|condition)/i,
  /^(the correct|the right|the proper|the actual)\s/i,
  /^(hint|tip|note|remember|keep in mind|fyi)/i,
  /\b(is wrong|is incorrect|doesn'?t work|isn'?t right|is not correct)\b/i,
  /\b(should be|should have|should use|should not|shouldn'?t)\b/i,
  /\b(smth like|something like|more like|like this)\b/i,
  /\b(please (use|try|change|fix|update|add|remove))\b/i,
]

// Patterns that strongly indicate a SQL query request
const QUERY_PATTERNS = [
  /^(show|get|find|list|count|give|tell|fetch|retrieve|display|pull)\s/i,
  /^(how many|what|which|who|where|when|calculate|compute)\s/i,
  /^(top|best|worst|most|least|highest|lowest|average|total|sum)\s/i,
  /^(compare|rank|group|breakdown|analyze|summarize)\s/i,
  /^SELECT\s/i,  // raw SQL
  /\?$/,  // ends with question mark
]

export function classifyInput(text: string): { type: InputType; confidence: number } {
  const trimmed = text.trim()

  // Very short inputs are ambiguous — default to query
  if (trimmed.length < 5) return { type: 'query', confidence: 0.5 }

  let suggestionScore = 0
  let queryScore = 0

  for (const pattern of SUGGESTION_PATTERNS) {
    if (pattern.test(trimmed)) suggestionScore++
  }

  for (const pattern of QUERY_PATTERNS) {
    if (pattern.test(trimmed)) queryScore++
  }

  // If it looks like raw SQL, always treat as query
  if (/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE)\s/i.test(trimmed)) {
    return { type: 'query', confidence: 1.0 }
  }

  if (suggestionScore > queryScore) {
    return { type: 'suggestion', confidence: Math.min(1.0, 0.5 + suggestionScore * 0.15) }
  }

  if (queryScore > 0) {
    return { type: 'query', confidence: Math.min(1.0, 0.5 + queryScore * 0.15) }
  }

  // Default to query if ambiguous
  return { type: 'query', confidence: 0.4 }
}
