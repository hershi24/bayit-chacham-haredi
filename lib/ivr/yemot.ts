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
  /**
   * Yemot's 7th keypress value blocks * when it is `yes` (the default we send).
   * Leave it empty only where * is a real menu choice.
   */
  allowStar?: boolean;
}): string {
  // Keypress list: field, reuse, max, min, seconds, playback, block *, then confirm last.
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
    input.allowStar ? "" : "yes",
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

/** Speak a line and then capture the next key, on the same API extension. */
export function yemotContinue(message: string, read: string): string {
  return `id_list_message=t-${cleanYemotText(message)}&${read.trim()}\n`;
}

/**
 * Record on the current extension. Value order matches Yemot's `record` read:
 * name, reuse, record, folder, file, skip the confirm menu, save on hangup,
 * append, minimum seconds, maximum seconds.
 * An empty folder keeps the file on this extension (or `api_dir` when that is set).
 * `no` in the confirm slot ends the recording on # without the extra menu.
 * Record mode has no silence timeout; the maximum seconds is what stops a stuck call.
 */
export function yemotRecord(input: { message: string; field: string; fileName: string; maxSeconds?: number }): string {
  const fileName = input.fileName.replace(/[^a-z0-9]/gi, "").slice(0, 24) || "voice";
  const capture = [input.field, "no", "record", "", fileName, "no", "", "no", "1", String(input.maxSeconds ?? 8)].join(",");
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
