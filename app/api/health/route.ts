import { loadConfig } from "@/lib/config";
import { HttpError } from "@/lib/http-error";
import { storageMode } from "@/lib/storage";

export const runtime = "nodejs";

export function GET() {
  try {
    return Response.json({ ok: true, mode: loadConfig().mode, storage: storageMode() });
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "האחסון לא מוגדר";
    return Response.json({ ok: false, mode: loadConfig().mode, message }, { status: 500 });
  }
}
