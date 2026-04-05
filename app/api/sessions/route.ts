import { NextRequest, NextResponse } from 'next/server'
import {
  loadSession,
  appendMessage,
  updateMessageFeedback,
  appendOptimization,
  listSessions,
} from '@/lib/session-store'
import type { SessionMessage, SessionOptimization } from '@/lib/session-store'

/**
 * GET /api/sessions — list all saved sessions
 * GET /api/sessions?db=name — load a specific session
 */
export async function GET(req: NextRequest) {
  const dbName = req.nextUrl.searchParams.get('db')

  if (dbName) {
    const session = loadSession(dbName)
    if (!session) {
      return NextResponse.json({ session: null })
    }
    return NextResponse.json({ session })
  }

  const sessions = listSessions()
  return NextResponse.json({ sessions })
}

/**
 * POST /api/sessions — save a message or optimization to a session
 *
 * Body: { action: 'message' | 'feedback' | 'optimization', ... }
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action } = body as { action: string }

  if (action === 'message') {
    const { dbName, dbType, message, currentPrompt } = body as {
      dbName: string
      dbType: string
      message: SessionMessage
      currentPrompt: string
    }
    const session = appendMessage(dbName, dbType, message, currentPrompt)
    return NextResponse.json({ ok: true, stats: session.stats })
  }

  if (action === 'feedback') {
    const { dbName, messageId, feedback } = body as {
      dbName: string
      messageId: string
      feedback: 'correct' | 'wrong'
    }
    updateMessageFeedback(dbName, messageId, feedback)
    return NextResponse.json({ ok: true })
  }

  if (action === 'optimization') {
    const { dbName, optimization, newPrompt } = body as {
      dbName: string
      optimization: SessionOptimization
      newPrompt: string
    }
    appendOptimization(dbName, optimization, newPrompt)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
