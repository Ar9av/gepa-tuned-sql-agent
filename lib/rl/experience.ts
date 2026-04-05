import {
  Experience,
  Episode,
  EpisodeStep,
  RLState,
  RepairAction,
  featurize,
  REPAIR_ACTION_NAMES,
  ERROR_CLASS_NAMES,
  RLMetrics,
} from './types'
import { computeEpisodeReward } from './grader'
import { LinUCB } from './linucb'
import fs from 'fs'
import path from 'path'

const EXPERIENCE_PATH = path.join(process.cwd(), 'data', 'rl-experiences.json')
const MAX_EPISODES = 500  // rolling buffer

/**
 * Experience store: logs episodes, persists to disk, and implements
 * Hindsight Experience Replay (HER) for reward relabeling.
 *
 * HER (Andrychowicz et al., 2017): If a later attempt in the same episode
 * succeeded, relabel earlier failed steps with partial credit proportional
 * to their distance from the success step. This multiplies the effective
 * training signal from sparse rewards.
 */

let episodes: Episode[] = []
let loaded = false

function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    if (fs.existsSync(EXPERIENCE_PATH)) {
      const raw = fs.readFileSync(EXPERIENCE_PATH, 'utf-8')
      episodes = JSON.parse(raw) as Episode[]
    }
  } catch {
    episodes = []
  }
}

function persist() {
  try {
    const dir = path.dirname(EXPERIENCE_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(EXPERIENCE_PATH, JSON.stringify(episodes.slice(-MAX_EPISODES)))
  } catch {}
}

/**
 * Record a completed episode and run HER relabeling on it.
 * Returns the relabeled experiences for immediate bandit update.
 */
export function recordEpisode(
  question: string,
  steps: EpisodeStep[],
  success: boolean,
): { episode: Episode; relabeled: Experience[] } {
  ensureLoaded()

  const stepRewards = steps.map(s => s.reward)
  const totalReward = computeEpisodeReward(stepRewards, success)

  const episode: Episode = {
    id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    question,
    steps,
    totalReward,
    success,
    timestamp: Date.now(),
  }

  episodes.push(episode)
  if (episodes.length > MAX_EPISODES) {
    episodes = episodes.slice(-MAX_EPISODES)
  }
  persist()

  // HER relabeling
  const relabeled = applyHER(episode)

  return { episode, relabeled }
}

/**
 * Hindsight Experience Replay (HER):
 *
 * If the episode eventually succeeded at step T, relabel earlier
 * failed steps with a hindsight bonus:
 *   bonus(t) = 0.3 * (1 - (T - t) / T)
 *
 * This gives more credit to steps closer to the eventual success,
 * under the assumption that they contributed more to the solution.
 *
 * If the episode never succeeded, no relabeling is applied.
 */
function applyHER(episode: Episode): Experience[] {
  const experiences: Experience[] = []
  const successStepIdx = episode.steps.findIndex(s => s.success)

  for (let t = 0; t < episode.steps.length; t++) {
    const step = episode.steps[t]
    let reward = step.reward

    // HER bonus: if a later step succeeded, give partial credit
    if (successStepIdx > t) {
      const distance = successStepIdx - t
      const totalSteps = episode.steps.length
      const herBonus = 0.3 * (1 - distance / totalSteps)
      reward += herBonus
    }

    const nextStep = t < episode.steps.length - 1 ? episode.steps[t + 1] : null

    experiences.push({
      state: step.featurized,
      action: step.action,
      reward,
      nextState: nextStep ? nextStep.featurized : null,
      done: t === episode.steps.length - 1,
      timestamp: episode.timestamp,
      metadata: {
        question: episode.question,
        errorMessage: step.errorMessage,
        sql: step.sql,
        errorClass: step.state.errorClass,
        attemptNumber: step.state.attemptNumber,
      },
    })
  }

  return experiences
}

/**
 * Replay all stored experiences through the bandit to rebuild weights.
 * Useful after a reset or if weights are lost.
 */
export function replayAll(bandit: LinUCB): number {
  ensureLoaded()
  let count = 0
  for (const ep of episodes) {
    const relabeled = applyHER(ep)
    for (const exp of relabeled) {
      bandit.update(exp.state, exp.action, exp.reward)
      count++
    }
  }
  return count
}

/**
 * Get aggregate metrics from the experience store.
 */
export function getMetrics(): RLMetrics {
  ensureLoaded()

  const recentWindow = 50
  const recent = episodes.slice(-recentWindow)
  const allSteps = episodes.flatMap(e => e.steps)

  const actionDist: Record<string, number> = {}
  const errorDist: Record<string, number> = {}
  for (const step of allSteps) {
    const aName = REPAIR_ACTION_NAMES[step.action]
    actionDist[aName] = (actionDist[aName] ?? 0) + 1
    const eName = ERROR_CLASS_NAMES[step.state.errorClass]
    errorDist[eName] = (errorDist[eName] ?? 0) + 1
  }

  return {
    totalEpisodes: episodes.length,
    totalSteps: allSteps.length,
    cumulativeReward: episodes.reduce((s, e) => s + e.totalReward, 0),
    successRate: recent.length > 0
      ? recent.filter(e => e.success).length / recent.length
      : 0,
    avgAttempts: recent.length > 0
      ? recent.reduce((s, e) => s + e.steps.length, 0) / recent.length
      : 0,
    actionDistribution: actionDist,
    errorDistribution: errorDist,
    rewardHistory: episodes.map(e => e.totalReward),
  }
}

export function getEpisodes(): Episode[] {
  ensureLoaded()
  return [...episodes]
}

export function getRecentEpisodes(n: number): Episode[] {
  ensureLoaded()
  return episodes.slice(-n)
}

export function resetExperience(): void {
  episodes = []
  loaded = true
  try { fs.unlinkSync(EXPERIENCE_PATH) } catch {}
}
