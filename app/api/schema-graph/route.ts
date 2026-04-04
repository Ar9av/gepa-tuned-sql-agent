import { getSchemaGraph } from '@/lib/db'
import { getActiveConfig } from '@/lib/connector'
import { extractSchemaGraph } from '@/lib/schema-extractor'

export async function GET() {
  const activeConfig = getActiveConfig()

  if (activeConfig) {
    const graph = await extractSchemaGraph()
    return Response.json(graph)
  }

  return Response.json(getSchemaGraph())
}
