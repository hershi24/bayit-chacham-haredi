import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";

export function GET() {
  return Response.json({ ok: true, mode: loadConfig().mode });
}
