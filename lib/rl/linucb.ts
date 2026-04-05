import { FEATURE_DIM, NUM_ACTIONS, RepairAction } from './types'
import fs from 'fs'
import path from 'path'

/**
 * LinUCB Contextual Bandit (Li et al., 2010)
 *
 * Maintains per-action inverse covariance matrices using the
 * Sherman-Morrison rank-1 update formula for O(d^2) updates
 * instead of O(d^3) full inversion.
 *
 * For each action a ∈ {0..K-1}:
 *   A_a^{-1} — d×d inverse covariance (starts as I_d)
 *   b_a      — d reward-weighted feature accumulator
 *   theta_a  = A_a^{-1} * b_a  (ridge regression estimate)
 *   UCB_a(x) = theta_a^T * x + alpha * sqrt(x^T * A_a^{-1} * x)
 *
 * Action selection: argmax_a UCB_a(x)
 */

const WEIGHTS_PATH = path.join(process.cwd(), 'data', 'rl-weights.json')

interface LinUCBWeights {
  Ainv: number[][][]   // K × d × d
  b: number[][]        // K × d
  counts: number[]     // per-action pull counts
  totalUpdates: number
}

export class LinUCB {
  private d: number
  private K: number
  private alpha: number
  private Ainv: number[][][]
  private b: number[][]
  private counts: number[]
  private totalUpdates: number

  constructor(
    d: number = FEATURE_DIM,
    K: number = NUM_ACTIONS,
    alpha: number = 1.5,  // exploration coefficient
  ) {
    this.d = d
    this.K = K
    this.alpha = alpha
    this.totalUpdates = 0

    // Try to load persisted weights
    const loaded = this.loadWeights()
    if (loaded) {
      this.Ainv = loaded.Ainv
      this.b = loaded.b
      this.counts = loaded.counts
      this.totalUpdates = loaded.totalUpdates
    } else {
      // Initialize: A_inv = I_d, b = 0 for each action
      this.Ainv = Array.from({ length: K }, () => identity(d))
      this.b = Array.from({ length: K }, () => zeros(d))
      this.counts = new Array(K).fill(0)
    }
  }

  /**
   * Select the action with highest upper confidence bound.
   * Returns both the action and the UCB scores for all actions.
   */
  selectAction(x: number[]): { action: RepairAction; scores: number[] } {
    const scores = new Array(this.K).fill(0)

    for (let a = 0; a < this.K; a++) {
      const theta = matVecMul(this.Ainv[a], this.b[a])
      const exploit = dot(theta, x)
      const explore = this.alpha * Math.sqrt(Math.max(0, quadForm(x, this.Ainv[a])))
      scores[a] = exploit + explore
    }

    // Argmax with random tie-breaking
    let bestAction = 0
    let bestScore = scores[0]
    for (let a = 1; a < this.K; a++) {
      if (scores[a] > bestScore || (scores[a] === bestScore && Math.random() > 0.5)) {
        bestScore = scores[a]
        bestAction = a
      }
    }

    return { action: bestAction as RepairAction, scores }
  }

  /**
   * Update the model after observing a reward.
   * Uses Sherman-Morrison formula: (A + xx^T)^{-1} = A^{-1} - (A^{-1}xx^TA^{-1}) / (1 + x^TA^{-1}x)
   */
  update(x: number[], action: RepairAction, reward: number): void {
    const a = action as number

    // Sherman-Morrison update for Ainv
    const Ainv_x = matVecMul(this.Ainv[a], x)       // d-vector
    const denom = 1 + dot(x, Ainv_x)                 // scalar
    // Ainv -= (Ainv_x * Ainv_x^T) / denom
    for (let i = 0; i < this.d; i++) {
      for (let j = 0; j < this.d; j++) {
        this.Ainv[a][i][j] -= (Ainv_x[i] * Ainv_x[j]) / denom
      }
    }

    // b += reward * x
    for (let i = 0; i < this.d; i++) {
      this.b[a][i] += reward * x[i]
    }

    this.counts[a]++
    this.totalUpdates++

    // Persist every 10 updates
    if (this.totalUpdates % 10 === 0) {
      this.saveWeights()
    }
  }

  /**
   * Get the estimated reward (theta^T * x) for each action — no exploration bonus.
   * Useful for understanding what the model has learned.
   */
  getEstimatedRewards(x: number[]): number[] {
    return Array.from({ length: this.K }, (_, a) => {
      const theta = matVecMul(this.Ainv[a], this.b[a])
      return dot(theta, x)
    })
  }

  getActionCounts(): number[] {
    return [...this.counts]
  }

  getTotalUpdates(): number {
    return this.totalUpdates
  }

  getAlpha(): number {
    return this.alpha
  }

  /**
   * Decay the exploration coefficient over time.
   * Call periodically to shift from exploration → exploitation.
   */
  decayAlpha(minAlpha: number = 0.3): void {
    this.alpha = Math.max(minAlpha, this.alpha * 0.995)
  }

  // ─── Persistence ─────────────────────────────────────────────

  saveWeights(): void {
    try {
      const dir = path.dirname(WEIGHTS_PATH)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const data: LinUCBWeights = {
        Ainv: this.Ainv,
        b: this.b,
        counts: this.counts,
        totalUpdates: this.totalUpdates,
      }
      fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(data))
    } catch {
      // Non-fatal — weights are rebuilt from experience replay if lost
    }
  }

  private loadWeights(): LinUCBWeights | null {
    try {
      if (!fs.existsSync(WEIGHTS_PATH)) return null
      const raw = fs.readFileSync(WEIGHTS_PATH, 'utf-8')
      const data = JSON.parse(raw) as LinUCBWeights
      // Validate dimensions
      if (
        data.Ainv.length === this.K &&
        data.Ainv[0].length === this.d &&
        data.b.length === this.K &&
        data.b[0].length === this.d
      ) {
        return data
      }
      return null
    } catch {
      return null
    }
  }

  reset(): void {
    this.Ainv = Array.from({ length: this.K }, () => identity(this.d))
    this.b = Array.from({ length: this.K }, () => zeros(this.d))
    this.counts = new Array(this.K).fill(0)
    this.totalUpdates = 0
    try { fs.unlinkSync(WEIGHTS_PATH) } catch {}
  }
}

// ─── Linear Algebra Helpers ─────────────────────────────────────
// Minimal implementations for d×d matrices where d ≈ 20.

function identity(d: number): number[][] {
  return Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0))
  )
}

function zeros(d: number): number[] {
  return new Array(d).fill(0)
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function matVecMul(M: number[][], v: number[]): number[] {
  const d = v.length
  const out = new Array(d).fill(0)
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      out[i] += M[i][j] * v[j]
    }
  }
  return out
}

/** x^T * M * x — quadratic form */
function quadForm(x: number[], M: number[][]): number {
  const Mx = matVecMul(M, x)
  return dot(x, Mx)
}
