/**
 * Line-by-line diff using the LCS (Longest Common Subsequence) algorithm.
 * Produces GitHub-style added/removed/unchanged output for prompt comparison.
 */

export type DiffLineType = 'added' | 'removed' | 'unchanged'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLineNo: number | null   // line number in the old text (null for added lines)
  newLineNo: number | null   // line number in the new text (null for removed lines)
}

export interface DiffResult {
  lines: DiffLine[]
  stats: {
    added: number
    removed: number
    unchanged: number
  }
}

/**
 * Compute the LCS table for two arrays of strings.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  return dp
}

/**
 * Backtrack through the LCS table to produce a diff.
 */
function backtrack(dp: number[][], a: string[], b: string[]): DiffLine[] {
  const lines: DiffLine[] = []
  let i = a.length
  let j = b.length

  // Collect in reverse, then reverse at the end
  const stack: DiffLine[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      stack.push({ type: 'unchanged', content: a[i - 1], oldLineNo: i, newLineNo: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: b[j - 1], oldLineNo: null, newLineNo: j })
      j--
    } else if (i > 0) {
      stack.push({ type: 'removed', content: a[i - 1], oldLineNo: i, newLineNo: null })
      i--
    }
  }

  stack.reverse()
  return stack
}

/**
 * Compute a line-by-line diff between two text strings.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  const dp = lcsTable(oldLines, newLines)
  const lines = backtrack(dp, oldLines, newLines)

  const stats = {
    added: lines.filter(l => l.type === 'added').length,
    removed: lines.filter(l => l.type === 'removed').length,
    unchanged: lines.filter(l => l.type === 'unchanged').length,
  }

  return { lines, stats }
}

/**
 * Group consecutive diff lines into hunks for more compact display.
 * Each hunk includes context lines around changes.
 */
export interface DiffHunk {
  lines: DiffLine[]
  hasChanges: boolean
}

export function groupIntoHunks(diff: DiffResult, contextLines: number = 2): DiffHunk[] {
  const { lines } = diff
  if (lines.length === 0) return []

  // Find indices of changed lines
  const changeIndices: number[] = []
  lines.forEach((line, i) => {
    if (line.type !== 'unchanged') changeIndices.push(i)
  })

  if (changeIndices.length === 0) {
    // No changes — return single hunk
    return [{ lines, hasChanges: false }]
  }

  // Build ranges around each change with context
  const ranges: [number, number][] = []
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - contextLines)
    const end = Math.min(lines.length - 1, idx + contextLines)

    if (ranges.length > 0 && start <= ranges[ranges.length - 1][1] + 1) {
      // Merge with previous range
      ranges[ranges.length - 1][1] = end
    } else {
      ranges.push([start, end])
    }
  }

  return ranges.map(([start, end]) => ({
    lines: lines.slice(start, end + 1),
    hasChanges: true,
  }))
}
