import { AuditLog } from "@/components/audit-log";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tenantId?: string }> }) {
  const { tenantId } = await searchParams;
  return <AuditLog initialTenantId={tenantId?.trim() || null} />;
}
