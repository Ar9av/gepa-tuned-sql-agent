import { ErrorClass } from './types'
import { errorSeverity } from './error-classifier'

/**
 * Shaped reward function for the SQL debug RL environment.
 *
 * Reward components:
 *   +1.0  base success reward
 *   -0.1  per attempt (attempt penalty — incentivizes early resolution)
 *   +0.2  if error severity decreased (progress signal)
 *   +0.1  if error class changed at all (exploration signal)
 *   -0.1  base failure penalty per step
 *
 * The shaping is potential-based (Ng et al., 1999), preserving
 * the optimal policy while accelerating learning.
 */

export interface GraderInput {
  success: boolean
  attemptNumber: number           // 1-indexed
  currentErrorClass: ErrorClass | null   // null if success
  previousErrorClass: ErrorClass | null  // null on first attempt
}

export interface GraderOutput {
  reward: number
  breakdown: {
    base: number
    attemptPenalty: number
    severityBonus: number
    changeBonus: number
  }
}

export function computeReward(input: GraderInput): GraderOutput {
  const { success, attemptNumber, currentErrorClass, previousErrorClass } = input

  if (success) {
    // Successful execution — reward decreases with attempts used
    const base = 1.0
    const attemptPenalty = -0.1 * (attemptNumber - 1)
    return {
      reward: base + attemptPenalty,
      breakdown: { base, attemptPenalty, severityBonus: 0, changeBonus: 0 },
    }
  }

  // Failed step — base penalty plus potential shaping
  const base = -0.1
  const attemptPenalty = -0.05 * attemptNumber

  let severityBonus = 0
  let changeBonus = 0

  if (previousErrorClass !== null && currentErrorClass !== null) {
    const prevSeverity = errorSeverity(previousErrorClass)
    const currSeverity = errorSeverity(currentErrorClass)

    // Severity decreased → progress toward a solution
    if (currSeverity < prevSeverity) {
      severityBonus = 0.2
    }
    // Severity increased → regression
    else if (currSeverity > prevSeverity) {
      severityBonus = -0.1
    }

    // Error class changed at all → at least something different happened
    if (currentErrorClass !== previousErrorClass) {
      changeBonus = 0.1
    }
  }

  const reward = base + attemptPenalty + severityBonus + changeBonus

  return {
    reward,
    breakdown: { base, attemptPenalty, severityBonus, changeBonus },
  }
}

/**
 * Compute the total episode reward from individual step rewards.
 * Includes a terminal bonus/penalty based on final outcome.
 */
export function computeEpisodeReward(stepRewards: number[], success: boolean): number {
  const sum = stepRewards.reduce((a, b) => a + b, 0)
  // Terminal bonus: extra +0.5 for eventual success, -0.5 for total failure
  const terminal = success ? 0.5 : -0.5
  return sum + terminal
}
