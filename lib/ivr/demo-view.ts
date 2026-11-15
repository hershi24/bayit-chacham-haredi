const DIGIT_WORDS: Record<string, string> = {
  אפס: "0",
  אחד: "1",
  אחת: "1",
  שתיים: "2",
  שלוש: "3",
  ארבע: "4",
  חמש: "5",
  שש: "6",
  שבע: "7",
  שמונה: "8",
  תשע: "9",
};

const WORD = Object.keys(DIGIT_WORDS).join("|");
const OPTION = new RegExp(`\\s*הקש\\s+(${WORD})(?=[,.]|\\s+ו|$)`, "g");
const DIGIT_RUN = new RegExp(`(?:(?:${WORD})(?:\\s+|$)){3,}`, "g");

export type SpokenPart = { kind: "text"; text: string } | { kind: "option"; key: string; label: string };

function sentences(text: string) {
  return text
    .split(/\.\s*/)
    .map((part) => part.replace(/[,\s]+$/, "").trim())
    .filter(Boolean);
}

function readable(text: string) {
  return text.replace(DIGIT_RUN, (run) =>
    run
      .trim()
      .split(/\s+/)
      .map((word) => DIGIT_WORDS[word])
      .join("") + " ",
  ).trim();
}

function stripPrefix(label: string) {
  if (label.startsWith("ול")) return label.slice(2);
  if (label.startsWith("ל")) return label.slice(1);
  return label;
}

/** Splits a spoken single-key menu into plain sentences and "press N for X" options, keeping their order. */
export function spokenParts(message: string): SpokenPart[] {
  const parts: SpokenPart[] = [];
  let rest = message;
  let found = false;
  for (const match of message.matchAll(OPTION)) {
    found = true;
    const start = message.length - rest.length;
    const chunk = message.slice(start, match.index).replace(/^[,.\s]+/, "");
    rest = message.slice(match.index + match[0].length);
    let labelAt = 0;
    for (const start of chunk.matchAll(/(?:^|[,.]\s*)(?=ו?ל)/g)) labelAt = start.index + start[0].length;
    for (const text of sentences(chunk.slice(0, labelAt))) parts.push({ kind: "text", text: readable(text) });
    const label = readable(stripPrefix(chunk.slice(labelAt).trim()));
    parts.push({ kind: "option", key: DIGIT_WORDS[match[1]] ?? match[1], label });
  }
  const tail = rest.replace(/^[,.\s]+/, "").trim();
  if (!found) return [{ kind: "text", text: message }];
  if (tail) parts.push({ kind: "text", text: tail });
  return parts;
}
