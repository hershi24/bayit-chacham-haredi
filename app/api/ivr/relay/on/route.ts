import { handleIvr } from "@/lib/ivr/handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handleIvr(request, "on");
}

export function POST(request: Request) {
  return handleIvr(request, "on");
}
