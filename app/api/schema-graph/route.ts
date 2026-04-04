import { getSchemaGraph } from '@/lib/db'

export async function GET() {
  return Response.json(getSchemaGraph())
}
