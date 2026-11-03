export function isYemotCall(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  return agent.toLowerCase().startsWith("yemot-core-api");
}

export function yemotSpeak(message: string): string {
  return `id_list_message=t-${cleanYemotText(message)}&go_to_folder=hangup\n`;
}

export function yemotRead(input: {
  message: string;
  field: string;
  min: number;
  max: number;
  allowed?: string;
  mode?: "No" | "Number" | "Time";
  seconds?: number;
}): string {
  const capture = [
    input.field,
    "no",
    String(input.max),
    String(input.min),
    String(input.seconds ?? 8),
    input.mode === "Number" || input.mode === "Time" ? input.mode : "No",
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
