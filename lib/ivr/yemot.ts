export function yemotSpeak(message: string): string {
  return `id_list_message=t-${cleanYemotText(message)}\n`;
}

export function yemotRead(input: {
  message: string;
  field: string;
  min: number;
  max: number;
  allowed?: string;
  mode?: "No" | "Number" | "Time";
}): string {
  const capture = [
    input.field,
    "",
    String(input.max),
    String(input.min),
    "8",
    input.mode === "Number" || input.mode === "Time" ? input.mode : "NO",
    "yes",
    "",
    "",
    input.allowed ?? "",
    "2",
    "",
    "",
    "",
    "no",
  ].join(",");
  return `read=t-${cleanYemotText(input.message)}=${capture}\n`;
}

export function cleanYemotText(message: string): string {
  return message.replace(/[\r\n=&-]/g, " ").replace(/\.+/g, ",").replace(/\s+/g, " ").trim();
}
