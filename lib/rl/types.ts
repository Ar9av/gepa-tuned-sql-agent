// ─── Error Taxonomy ─────────────────────────────────────────────
// 8 canonical SQLite error classes. The bandit learns which repair
// strategy works best for each error class.

export enum ErrorClass {
  NO_SUCH_COLUMN    = 0,
  NO_SUCH_TABLE     = 1,
  SYNTAX_ERROR      = 2,
  AMBIGUOUS_COLUMN  = 3,
  DATATYPE_MISMATCH = 4,
  NO_SUCH_FUNCTION  = 5,
  AGGREGATION_ERROR = 6,
  OTHER             = 7,
}

export const ERROR_CLASS_NAMES: Record<ErrorClass, string> = {
  [ErrorClass.NO_SUCH_COLUMN]:    'no_such_column',
  [ErrorClass.NO_SUCH_TABLE]:     'no_such_table',
  [ErrorClass.SYNTAX_ERROR]:      'syntax_error',
  [ErrorClass.AMBIGUOUS_COLUMN]:  'ambiguous_column',
  [ErrorClass.DATATYPE_MISMATCH]: 'datatype_mismatch',
  [ErrorClass.NO_SUCH_FUNCTION]:  'no_such_function',
  [ErrorClass.AGGREGATION_ERROR]: 'aggregation_error',
  [ErrorClass.OTHER]:             'other',
}

export const NUM_ERROR_CLASSES = 8

// ─── Repair Actions ─────────────────────────────────────────────
// 8 discrete repair strategies. Each maps to a specialized prompt
// template that guides the LLM toward a specific kind of fix.

export enum RepairAction {
  REWRITE_FULL   = 0,
  FIX_COLUMN     = 1,
  FIX_TABLE      = 2,
  ADD_GROUPBY    = 3,
  REWRITE_CTE    = 4,
  FIX_SYNTAX     = 5,
  CHANGE_DIALECT = 6,
  RELAX_FILTER   = 7,
}

export const REPAIR_ACTION_NAMES: Record<RepairAction, string> = {
  [RepairAction.REWRITE_FULL]:   'rewrite_full',
  [RepairAction.FIX_COLUMN]:     'fix_column',
  [RepairAction.FIX_TABLE]:      'fix_table',
  [RepairAction.ADD_GROUPBY]:    'add_groupby',
  [RepairAction.REWRITE_CTE]:    'rewrite_cte',
  [RepairAction.FIX_SYNTAX]:     'fix_syntax',
  [RepairAction.CHANGE_DIALECT]: 'change_dialect',
  [RepairAction.RELAX_FILTER]:   'relax_filter',
}

export const NUM_ACTIONS = 8

// ─── State ──────────────────────────────────────────────────────
// The structured observation the bandit sees at each debug step.

export interface RLState {
  errorClass: ErrorClass
  attemptNumber: number           // 1-indexed
  previousAction: RepairAction | null
  errorChanged: boolean           // did error class change from previous attempt?
  consecutiveSameError: number    // how many times the same error class in a row
}

// Feature vector: 8 (error one-hot) + 1 (attempt) + 8 (prev action one-hot) + 1 (error changed) + 1 (consecutive) + 1 (bias) = 20
export const FEATURE_DIM = 20

export function featurize(state: RLState): number[] {
  const x = new Array(FEATURE_DIM).fill(0)

  // Error class one-hot [0..7]
  x[state.errorClass] = 1.0

  // Attempt number normalized [8]
  x[8] = state.attemptNumber / 5.0

  // Previous action one-hot [9..16]
  if (state.previousAction !== null) {
    x[9 + state.previousAction] = 1.0
  }

  // Error changed flag [17]
  x[17] = state.errorChanged ? 1.0 : 0.0

  // Consecutive same error normalized [18]
  x[18] = Math.min(state.consecutiveSameError, 5) / 5.0

  // Bias term [19]
  x[19] = 1.0

  return x
}

// ─── Experience ─────────────────────────────────────────────────

export interface Experience {
  state: number[]              // featurized state vector
  action: RepairAction
  reward: number
  nextState: number[] | null   // null if terminal
  done: boolean
  timestamp: number
  metadata: {
    question: string
    errorMessage: string
    sql: string
    errorClass: ErrorClass
    attemptNumber: number
  }
}

export interface EpisodeStep {
  state: RLState
  featurized: number[]
  action: RepairAction
  reward: number
  errorMessage: string
  sql: string
  success: boolean
}

export interface Episode {
  id: string
  question: string
  steps: EpisodeStep[]
  totalReward: number
  success: boolean
  timestamp: number
}

// ─── Metrics ────────────────────────────────────────────────────

export interface RLMetrics {
  totalEpisodes: number
  totalSteps: number
  cumulativeReward: number
  successRate: number                     // rolling over last 50
  avgAttempts: number                     // rolling over last 50
  actionDistribution: Record<string, number>  // counts per action
  errorDistribution: Record<string, number>   // counts per error class
  rewardHistory: number[]                 // per-episode total rewards
}
