export type IvrOutcome =
  | { kind: "on-success" }
  | { kind: "off-success" }
  | { kind: "pending" }
  | { kind: "timeout"; relayOn: boolean | null }
  | { kind: "status"; relayOn: boolean | null }
  | { kind: "offline" }
  | { kind: "not-found" }
  | { kind: "ambiguous" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "frozen" }
  | { kind: "unauthorized" };

export function speechFor(outcome: IvrOutcome): string {
  switch (outcome.kind) {
    case "on-success":
      return "השקע הופעל בהצלחה";
    case "off-success":
      return "השקע כובה בהצלחה";
    case "pending":
      return "הפקודה נשלחה לשקע וממתינה לאישור";
    case "timeout":
      if (outcome.relayOn === true) return "לא התקבל אישור מהשקע. השקע פועל כעת";
      if (outcome.relayOn === false) return "לא התקבל אישור מהשקע. השקע כבוי כעת";
      return "לא התקבל אישור מהשקע";
    case "status":
      if (outcome.relayOn === true) return "השקע פועל כעת";
      if (outcome.relayOn === false) return "השקע כבוי כעת";
      return "מצב השקע אינו ידוע";
    case "offline":
      return "השקע אינו מחובר כעת";
    case "not-found":
      return "השקע לא נמצא";
    case "ambiguous":
      return "למספר הזה משויכים כמה שקעים. יש לציין מזהה שקע";
    case "missing":
      return "לא צוין שקע או מספר טלפון";
    case "failed":
      return "הפעולה נכשלה";
    case "frozen":
      return "השקע מוקפא";
    case "unauthorized":
      return "אין הרשאה לפעולה";
  }
}

export function yemotBody(speech: string): string {
  const cleaned = speech.replace(/[\r\n=&.-]/g, " ").replace(/\s+/g, " ").trim();
  return `id_list_message=t-${cleaned}&go_to_folder=hangup\n`;
}
