import { handleIvr } from "@/lib/ivr/handle";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handleIvr(request, "off");
}

export function POST(request: Request) {
  return handleIvr(request, "off");
}
