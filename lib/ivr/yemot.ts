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
  /** Value Yemot posts when allowEmpty times out (keeps the next API turn from replaying). */
  emptyVal?: string;
  /**
   * How many times Yemot replays the prompt before accepting empty/timeout.
   * Default 2 matches the rest of the menu. Use 1 for one-shot wait lines.
   */
  attempts?: number;
}): string {
  // Keypress list: field, reuse, max, min, seconds, playback, then confirm last.
  // max and min are the capture length. playback is how Yemot speaks the buffer:
  // No is silent, Number speaks a number and drops a leading zero.
  // The final no is confirm, which only skips "לאישור הקישו אחת".
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
    String(input.attempts ?? 2),
    input.allowEmpty ? "Ok" : "",
    input.emptyVal ?? "",
    "",
    "no",
  ].join(",");
  return `read=t-${cleanYemotText(input.message)}=${capture}\n`;
}

/**
 * Yemot Hebrew TTS reads «דוד» as the name David. Cue the boiler reading with holam.
 * Applied to every spoken line so device nicknames like «דוד שמש» sound right.
 */
export function speakHebrewAmbiguities(message: string): string {
  return message.replace(/דוד/g, "דוֹד");
}

export function cleanYemotText(message: string): string {
  return speakHebrewAmbiguities(message)
    .replace(/[\r\n=&-]/g, " ")
    .replace(/\.+/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}
