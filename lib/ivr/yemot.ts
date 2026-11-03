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
  mode?: "No" | "Number" | "Time" | "Digits" | "Date";
  seconds?: number;
  allowEmpty?: boolean;
}): string {
  const playback =
    input.mode === "Number" || input.mode === "Time" || input.mode === "Digits" || input.mode === "Date" ? input.mode : "No";
  const capture = [
    input.field,
    "no",
    String(input.max),
    String(input.min),
    String(input.seconds ?? 8),
    playback,
    "yes",
    "",
    "",
    input.allowed ?? "",
    "2",
    input.allowEmpty ? "Ok" : "",
    "",
    "",
    "no",
  ].join(",");
  return `read=t-${cleanYemotText(input.message)}=${capture}\n`;
}

export function cleanYemotText(message: string): string {
  return message.replace(/[\r\n=&-]/g, " ").replace(/\.+/g, ",").replace(/\s+/g, " ").trim();
}
