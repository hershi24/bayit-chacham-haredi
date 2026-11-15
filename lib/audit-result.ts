export function auditSucceeded(result: string) {
  return result === "SUCCESS" || result === "OK" || result === "OPEN";
}

export function auditResultLabel(result: string) {
  if (result === "SUCCESS" || result === "OK") return "בוצע";
  if (result === "SENT") return "נשלח, ממתין לאישור";
  if (result === "OPEN") return "פתוח";
  if (result === "FAILED") return "נכשל";
  return `נכשל (${result})`;
}
