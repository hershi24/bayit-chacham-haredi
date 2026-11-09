import { cleanYemotText } from "@/lib/ivr/yemot";

export type IvrOutcome =
  | { kind: "on-success"; name?: string }
  | { kind: "off-success"; name?: string }
  | { kind: "pending"; name?: string }
  | { kind: "timeout"; relayOn: boolean | null; name?: string }
  | { kind: "status"; relayOn: boolean | null; name?: string }
  | { kind: "offline"; name?: string }
  | { kind: "not-found" }
  | { kind: "ambiguous" }
  | { kind: "missing" }
  | { kind: "failed" }
  | { kind: "frozen"; name?: string }
  | { kind: "unauthorized" };

function deviceLabel(name: string | undefined) {
  const trimmed = name?.trim();
  return trimmed || "השקע";
}

export function speechFor(outcome: IvrOutcome): string {
  const label = "name" in outcome ? deviceLabel(outcome.name) : "השקע";
  switch (outcome.kind) {
    case "on-success":
      return `${label} הופעל בהצלחה`;
    case "off-success":
      return `${label} נכבה בהצלחה`;
    case "pending":
      return `הפקודה נשלחה ל${label} וממתינה לאישור`;
    case "timeout":
      if (outcome.relayOn === true) return `לא התקבל אישור מ${label}. ${label} פועל כעת`;
      if (outcome.relayOn === false) return `לא התקבל אישור מ${label}. ${label} כבוי כעת`;
      return `לא התקבל אישור מ${label}`;
    case "status":
      if (outcome.relayOn === true) return `${label} פועל כעת`;
      if (outcome.relayOn === false) return `${label} כבוי כעת`;
      return `מצב ${label} אינו ידוע`;
    case "offline":
      return `${label} אינו מחובר כעת`;
    case "not-found":
      return "השקע לא נמצא";
    case "ambiguous":
      return "למספר הזה משויכים כמה שקעים. יש לציין מזהה שקע";
    case "missing":
      return "לא צוין שקע או מספר טלפון";
    case "failed":
      return "הפעולה נכשלה";
    case "frozen":
      return `לא ניתן לשלוט ב${label}, הוא מוקפא`;
    case "unauthorized":
      return "אין הרשאה לפעולה";
  }
}

export function yemotBody(speech: string): string {
  return `id_list_message=t-${cleanYemotText(speech)}&go_to_folder=hangup\n`;
}
