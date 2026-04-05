import {
  RLState,
  RepairAction,
  ErrorClass,
  EpisodeStep,
  featurize,
  REPAIR_ACTION_NAMES,
  ERROR_CLASS_NAMES,
  RLMetrics,
} from './types'
import { classifyError, extractOffendingToken } from './error-classifier'
import { computeReward, GraderInput } from './grader'
import { LinUCB } from './linucb'
import { recordEpisode, getMetrics, resetExperience } from './experience'
import { getRepairSystemSuffix, buildRepairUserMessage, RepairContext } from './repair-strategies'

/**
 * SQLDebugEnvironment — Gym-like RL environment for the SQL debug loop.
 *
 * Lifecycle:
 *   1. env.reset(question)          — start new episode
 *   2. env.observeError(error, sql) — classify error, build state
 *   3. env.selectAction()           — bandit picks repair strategy
 *   4. env.getRepairPrompt(...)     — get specialized prompt for chosen action
 *   5. env.recordStep(success)      — record outcome, compute reward
 *   6. Repeat 2-5 until success or max attempts
 *   7. env.endEpisode(success)      — finalize, HER relabeling, bandit update
 */

// Singleton instances (server-side module scope)
let bandit: LinUCB | null = null
let currentEpisode: EpisodeContext | null = null

interface EpisodeContext {
  question: string
  steps: EpisodeStep[]
  previousErrorClass: ErrorClass | null
  consecutiveSameError: number
  lastAction: RepairAction | null
  currentState: RLState | null
  currentFeatures: number[] | null
}

function getBandit(): LinUCB {
  if (!bandit) {
    bandit = new LinUCB()
  }
  return bandit
}

// ─── Environment Interface ──────────────────────────────────────

/**
 * Start a new episode for a user question.
 */
export function reset(question: string): void {
  // If previous episode wasn't finalized, end it as a failure
  if (currentEpisode && currentEpisode.steps.length > 0) {
    endEpisode(false)
  }

  currentEpisode = {
    question,
    steps: [],
    previousErrorClass: null,
    consecutiveSameError: 0,
    lastAction: null,
    currentState: null,
    currentFeatures: null,
  }
}

/**
 * Observe a SQL execution error. Classifies it and builds the RL state.
 * Returns the error classification for logging.
 */
export function observeError(
  errorMessage: string,
  failingSQL: string,
  attemptNumber: number,
): { errorClass: ErrorClass; errorClassName: string; state: RLState } {
  if (!currentEpisode) throw new Error('Call reset() before observeError()')

  const errorClass = classifyError(errorMessage)
  const errorChanged = currentEpisode.previousErrorClass !== null &&
    currentEpisode.previousErrorClass !== errorClass

  // Track consecutive same-error count
  if (currentEpisode.previousErrorClass === errorClass) {
    currentEpisode.consecutiveSameError++
  } else {
    currentEpisode.consecutiveSameError = 1
  }

  const state: RLState = {
    errorClass,
    attemptNumber,
    previousAction: currentEpisode.lastAction,
    errorChanged,
    consecutiveSameError: currentEpisode.consecutiveSameError,
  }

  currentEpisode.currentState = state
  currentEpisode.currentFeatures = featurize(state)

  return {
    errorClass,
    errorClassName: ERROR_CLASS_NAMES[errorClass],
    state,
  }
}

/**
 * Ask the bandit to select a repair action based on current state.
 * Returns the chosen action and all UCB scores.
 */
export function selectAction(): {
  action: RepairAction
  actionName: string
  scores: number[]
} {
  if (!currentEpisode?.currentFeatures) {
    throw new Error('Call observeError() before selectAction()')
  }

  const b = getBandit()
  const { action, scores } = b.selectAction(currentEpisode.currentFeatures)

  currentEpisode.lastAction = action

  return {
    action,
    actionName: REPAIR_ACTION_NAMES[action],
    scores,
  }
}

/**
 * Get the specialized system prompt suffix and user message for the chosen action.
 */
export function getRepairPrompt(
  action: RepairAction,
  schema: string,
  question: string,
  failingSQL: string,
  errorMessage: string,
): { systemSuffix: string; userMessage: string } {
  const offendingToken = extractOffendingToken(errorMessage)

  const ctx: RepairContext = {
    schema,
    question,
    failingSQL,
    errorMessage,
    offendingToken,
  }

  return {
    systemSuffix: getRepairSystemSuffix(action),
    userMessage: buildRepairUserMessage(action, ctx),
  }
}

/**
 * Record the outcome of a repair step (success or new error).
 * Computes shaped reward internally.
 */
export function recordStep(
  action: RepairAction,
  success: boolean,
  errorMessage: string,
  sql: string,
): { reward: number; breakdown: ReturnType<typeof computeReward>['breakdown'] } {
  if (!currentEpisode?.currentState || !currentEpisode.currentFeatures) {
    throw new Error('Call observeError() before recordStep()')
  }

  const state = currentEpisode.currentState

  const graderInput: GraderInput = {
    success,
    attemptNumber: state.attemptNumber,
    currentErrorClass: success ? null : classifyError(errorMessage),
    previousErrorClass: currentEpisode.previousErrorClass,
  }

  const { reward, breakdown } = computeReward(graderInput)

  const step: EpisodeStep = {
    state,
    featurized: currentEpisode.currentFeatures,
    action,
    reward,
    errorMessage,
    sql,
    success,
  }

  currentEpisode.steps.push(step)
  currentEpisode.previousErrorClass = state.errorClass

  return { reward, breakdown }
}

/**
 * End the current episode. Runs HER relabeling and updates the bandit.
 */
export function endEpisode(success: boolean): {
  totalReward: number
  episodeLength: number
} | null {
  if (!currentEpisode || currentEpisode.steps.length === 0) {
    currentEpisode = null
    return null
  }

  const b = getBandit()
  const { episode, relabeled } = recordEpisode(
    currentEpisode.question,
    currentEpisode.steps,
    success,
  )

  // Update bandit with HER-relabeled experiences
  for (const exp of relabeled) {
    b.update(exp.state, exp.action, exp.reward)
  }

  // Decay exploration over time
  b.decayAlpha()

  const result = {
    totalReward: episode.totalReward,
    episodeLength: episode.steps.length,
  }

  currentEpisode = null
  return result
}

// ─── Query Interface ────────────────────────────────────────────

export function getRLMetrics(): RLMetrics {
  return getMetrics()
}

export function getBanditState(): {
  actionCounts: number[]
  totalUpdates: number
  alpha: number
} {
  const b = getBandit()
  return {
    actionCounts: b.getActionCounts(),
    totalUpdates: b.getTotalUpdates(),
    alpha: b.getAlpha(),
  }
}

export function isEpisodeActive(): boolean {
  return currentEpisode !== null
}

/**
 * Reset the entire RL system — bandit weights, experience store.
 */
export function resetRL(): void {
  if (bandit) bandit.reset()
  resetExperience()
  currentEpisode = null
}
