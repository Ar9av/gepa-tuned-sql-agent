import { getHistory, getParetoFront, getCurrentPrompt } from '@/lib/gepa'
import { getSchemaInfo } from '@/lib/db'

export async function GET() {
  return Response.json({
    history: getHistory(),
    paretoFront: getParetoFront(),
    currentPrompt: getCurrentPrompt(),
    schema: getSchemaInfo(),
  })
}
