import { HttpError } from "@/lib/http-error";

export type StorageMode = "sqlite" | "supabase";

export function storageMode(): StorageMode {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url && !key) return "sqlite";
  if (!url || !key) throw new HttpError(500, "חסר SUPABASE_URL או SUPABASE_SERVICE_ROLE_KEY");
  return "supabase";
}
