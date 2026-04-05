import { RepairAction } from './types'

/**
 * Each repair strategy is a specialized prompt injection that steers the LLM
 * toward a specific class of fix. The bandit learns which strategy to apply
 * based on the error class and attempt history.
 *
 * All strategies receive: schema, question, failing SQL, error message.
 * They differ in the system-level instruction that frames the repair.
 */

interface RepairStrategy {
  action: RepairAction
  name: string
  systemSuffix: string   // appended to the base system prompt
  userTemplate: (ctx: RepairContext) => string
}

export interface RepairContext {
  schema: string
  question: string
  failingSQL: string
  errorMessage: string
  offendingToken: string | null
}

const strategies: Record<RepairAction, RepairStrategy> = {
  [RepairAction.REWRITE_FULL]: {
    action: RepairAction.REWRITE_FULL,
    name: 'Full Rewrite',
    systemSuffix: `\n\nIMPORTANT: The previous SQL attempt was fundamentally flawed. Discard it entirely and write a new query from scratch based only on the schema and question. Do NOT try to patch the previous SQL.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nA previous attempt failed with: ${ctx.errorMessage}\n\nWrite a completely new SQL query from scratch. Do NOT reference the previous attempt.`,
  },

  [RepairAction.FIX_COLUMN]: {
    action: RepairAction.FIX_COLUMN,
    name: 'Fix Column',
    systemSuffix: `\n\nIMPORTANT: The previous SQL referenced a wrong column name. Carefully check the schema for the exact column names in each table. Pay attention to singular vs plural, underscores, and exact spelling.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}${ctx.offendingToken ? `\n\nThe problematic column is: ${ctx.offendingToken}` : ''}\n\nFix ONLY the column name issue. Check the schema for correct column names.`,
  },

  [RepairAction.FIX_TABLE]: {
    action: RepairAction.FIX_TABLE,
    name: 'Fix Table',
    systemSuffix: `\n\nIMPORTANT: The previous SQL referenced a wrong table name or had incorrect JOIN relationships. Check the schema for exact table names and foreign key relationships.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}${ctx.offendingToken ? `\n\nThe problematic table is: ${ctx.offendingToken}` : ''}\n\nFix the table name or JOIN issue. Verify all table names exist in the schema.`,
  },

  [RepairAction.ADD_GROUPBY]: {
    action: RepairAction.ADD_GROUPBY,
    name: 'Fix GROUP BY',
    systemSuffix: `\n\nIMPORTANT: The previous SQL has an aggregation error. Every column in SELECT that is not inside an aggregate function (COUNT, SUM, AVG, etc.) MUST appear in the GROUP BY clause. Check all selected columns.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}\n\nFix the GROUP BY / aggregation issue. Ensure every non-aggregate column in SELECT is in GROUP BY.`,
  },

  [RepairAction.REWRITE_CTE]: {
    action: RepairAction.REWRITE_CTE,
    name: 'Rewrite CTE/Subquery',
    systemSuffix: `\n\nIMPORTANT: The previous SQL had issues with CTEs or subqueries. Restructure the query — consider using WITH clauses for clarity, or flatten nested subqueries. Ensure CTE column names are explicitly defined if needed.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}\n\nRestructure the CTEs or subqueries. Break the query into clear, named WITH clauses.`,
  },

  [RepairAction.FIX_SYNTAX]: {
    action: RepairAction.FIX_SYNTAX,
    name: 'Fix Syntax',
    systemSuffix: `\n\nIMPORTANT: The previous SQL has a syntax error. Check for: missing commas, unmatched parentheses, misspelled keywords, incorrect operator usage, missing AS aliases.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}${ctx.offendingToken ? `\n\nSyntax error near: ${ctx.offendingToken}` : ''}\n\nFix the syntax error. Check for typos, missing commas, unmatched parentheses.`,
  },

  [RepairAction.CHANGE_DIALECT]: {
    action: RepairAction.CHANGE_DIALECT,
    name: 'Fix Dialect',
    systemSuffix: `\n\nIMPORTANT: The previous SQL used functions or syntax not available in SQLite. Key SQLite rules:
- Use strftime() for date formatting, NOT DATE_FORMAT or EXTRACT
- No FULL OUTER JOIN or RIGHT JOIN — use LEFT JOIN with UNION
- Use CAST(x AS INTEGER), not CONVERT()
- No ILIKE — use LIKE (case-insensitive by default for ASCII)
- String concatenation uses || not CONCAT()
- No LIMIT inside subqueries with IN (use CTE instead)`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}\n\nThe SQL uses functions or syntax not supported by SQLite. Rewrite using SQLite-compatible alternatives.`,
  },

  [RepairAction.RELAX_FILTER]: {
    action: RepairAction.RELAX_FILTER,
    name: 'Relax Filter',
    systemSuffix: `\n\nIMPORTANT: The previous SQL may have overly restrictive WHERE conditions, incorrect date ranges, or wrong filter values causing empty results or errors. Review the filter conditions and broaden them to capture the intended data.`,
    userTemplate: (ctx) =>
      `Schema:\n${ctx.schema}\n\nQuestion: ${ctx.question}\n\nPrevious SQL:\n${ctx.failingSQL}\n\nError: ${ctx.errorMessage}\n\nReview and relax the WHERE/HAVING conditions. Check date formats, value ranges, and filter logic.`,
  },
}

/**
 * Get the system prompt suffix for a repair action.
 */
export function getRepairSystemSuffix(action: RepairAction): string {
  return strategies[action].systemSuffix
}

/**
 * Build the full user message for a repair action.
 */
export function buildRepairUserMessage(action: RepairAction, ctx: RepairContext): string {
  return strategies[action].userTemplate(ctx)
}

/**
 * Get the human-readable name of a repair action.
 */
export function getRepairName(action: RepairAction): string {
  return strategies[action].name
}
