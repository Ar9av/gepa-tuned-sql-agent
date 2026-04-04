import { disconnectDB } from '@/lib/connector'

export async function POST() {
  disconnectDB()
  return Response.json({ ok: true })
}
