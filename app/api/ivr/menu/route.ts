import { handleMenu } from "@/lib/ivr/menu";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handleMenu(request);
}

export function POST(request: Request) {
  return handleMenu(request);
}
