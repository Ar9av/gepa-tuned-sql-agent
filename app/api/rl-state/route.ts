import { NextResponse } from 'next/server'
import { getRLMetrics, getBanditState, resetRL } from '@/lib/rl/environment'
import { getRecentEpisodes } from '@/lib/rl/experience'
import { REPAIR_ACTION_NAMES, ERROR_CLASS_NAMES, NUM_ACTIONS } from '@/lib/rl/types'

/**
 * GET /api/rl-state
 * Returns the full RL system state for UI visualization:
 *   - Bandit weights metadata (action counts, exploration rate)
 *   - Aggregate metrics (success rate, avg attempts, reward curve)
 *   - Action & error distributions
 *   - Recent episodes with step-level detail
 */
export async function GET() {
  const metrics = getRLMetrics()
  const banditState = getBanditState()
  const recentEpisodes = getRecentEpisodes(20)

  // Map action indices to names for the UI
  const actionNames = Array.from({ length: NUM_ACTIONS }, (_, i) =>
    REPAIR_ACTION_NAMES[i as keyof typeof REPAIR_ACTION_NAMES]
  )

  return NextResponse.json({
    metrics,
    bandit: {
      ...banditState,
      actionNames,
    },
    recentEpisodes: recentEpisodes.map(ep => ({
      id: ep.id,
      question: ep.question,
      success: ep.success,
      totalReward: ep.totalReward,
      stepCount: ep.steps.length,
      timestamp: ep.timestamp,
      steps: ep.steps.map(s => ({
        action: REPAIR_ACTION_NAMES[s.action],
        errorClass: ERROR_CLASS_NAMES[s.state.errorClass],
        reward: s.reward,
        success: s.success,
        attemptNumber: s.state.attemptNumber,
      })),
    })),
  })
}

/**
 * DELETE /api/rl-state
 * Reset the RL system — clears bandit weights and experience store.
 */
export async function DELETE() {
  resetRL()
  return NextResponse.json({ status: 'reset' })
}
