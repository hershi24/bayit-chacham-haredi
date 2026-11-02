import { loadConfig } from "@/lib/config";
import { requireAdmin, requireUser, withErrors } from "@/lib/session";

export const runtime = "nodejs";

export function GET() {
  return withErrors(async () => {
    requireAdmin(await requireUser());
    const config = loadConfig();
    return Response.json({
      token: config.ivrToken,
      defaultToken: config.ivrTokenIsDefault,
      paths: {
        menu: "/api/ivr/menu",
        on: "/api/ivr/relay/on",
        off: "/api/ivr/relay/off",
        status: "/api/ivr/relay/status",
      },
    });
  });
}
