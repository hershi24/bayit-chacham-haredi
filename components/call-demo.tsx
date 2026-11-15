"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneOff, RotateCcw } from "lucide-react";
import type { MenuRead } from "@/lib/ivr/flow";
import { demoAnswer, demoHome, type DemoHome, type DemoValues } from "@/lib/ivr/demo";

type Line = { from: "sys" | "me" | "note"; text: string };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const WAIT_MS = 1200;

function keyHint(read: MenuRead | null) {
  if (!read || read.max === 1) return null;
  if (read.min === read.max) return `מקישים ${read.max} ספרות`;
  return "מקישים ומסיימים בסולמית (#)";
}

export function CallDemo() {
  const homeRef = useRef<DemoHome | null>(null);
  const valuesRef = useRef<DemoValues>({});
  const waitRef = useRef<number | null>(null);
  const resumeRef = useRef<() => void>(() => {});
  const screenRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, setPending] = useState<MenuRead | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [seconds, setSeconds] = useState(0);

  const step = useCallback(() => {
    const home = homeRef.current;
    if (!home) return;
    const turn = demoAnswer(home, valuesRef.current);
    if (turn.type === "read") {
      setPending(turn.read);
      setLines((all) => [...all, { from: "sys", text: turn.read.message }]);
      return;
    }
    if (turn.type === "wait") {
      setPending(null);
      setWaiting(true);
      setLines((all) => [...all, { from: "sys", text: turn.message }]);
      waitRef.current = window.setTimeout(() => {
        valuesRef.current = { ...valuesRef.current, pikud_ready: "1" };
        setWaiting(false);
        resumeRef.current();
      }, WAIT_MS);
      return;
    }
    setPending(null);
    setEnded(true);
    setLines((all) => [...all, { from: "sys", text: turn.message }, { from: "note", text: "השיחה הסתיימה" }]);
  }, []);

  useEffect(() => {
    resumeRef.current = step;
  }, [step]);

  const start = useCallback(() => {
    if (waitRef.current) window.clearTimeout(waitRef.current);
    homeRef.current = homeRef.current ?? demoHome();
    valuesRef.current = {};
    setLines([]);
    setBuffer("");
    setEnded(false);
    setWaiting(false);
    setSeconds(0);
    step();
  }, [step]);

  useEffect(() => {
    const timer = window.setTimeout(start, 0);
    return () => {
      window.clearTimeout(timer);
      if (waitRef.current) window.clearTimeout(waitRef.current);
    };
  }, [start]);

  useEffect(() => {
    if (ended) return;
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [ended]);

  useEffect(() => {
    const screen = screenRef.current;
    if (screen) screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function submit(read: MenuRead, input: string) {
    setBuffer("");
    setLines((all) => [...all, { from: "me", text: input ? `הקשתם ${input}` : "הקשתם סולמית" }]);
    valuesRef.current = { ...valuesRef.current, [read.field]: input };
    step();
  }

  function press(key: string) {
    const read = pending;
    if (ended || waiting || !read) return;
    if (read.max === 1) {
      if (key !== "*" && key !== "#") submit(read, key);
      return;
    }
    if (key === "*") return setBuffer("");
    if (key === "#") {
      if (buffer.length >= read.min || (read.allowEmpty && !buffer)) submit(read, buffer);
      return;
    }
    const next = buffer + key;
    if (next.length >= read.max) submit(read, next);
    else setBuffer(next);
  }

  function hangUp() {
    if (ended) return;
    if (waitRef.current) window.clearTimeout(waitRef.current);
    setPending(null);
    setWaiting(false);
    setEnded(true);
    setLines((all) => [...all, { from: "note", text: "ניתקתם את השיחה" }]);
  }

  const hint = keyHint(pending);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="phone">
      <div className="phone-head">
        <span className={ended ? "phone-dot off" : "phone-dot"} />
        <span>{ended ? "השיחה הסתיימה" : "בשיחה עם הבית"}</span>
        <span className="phone-time" dir="ltr">
          {clock}
        </span>
      </div>
      <div className="phone-screen" ref={screenRef} aria-live="polite">
        {lines.map((line, index) => (
          <p key={index} className={line.from === "me" ? "bubble me" : line.from === "note" ? "bubble note" : "bubble"}>
            {line.text}
          </p>
        ))}
        {ended ? (
          <button type="button" className="restart" onClick={start}>
            <RotateCcw size={15} /> שיחה חדשה
          </button>
        ) : null}
      </div>
      <div className="phone-entry" aria-live="polite">
        {hint ? (
          <>
            <span>{hint}</span>
            <strong dir="ltr">{buffer || "—"}</strong>
          </>
        ) : (
          <span>{waiting ? "בודק את מצב ההתקן…" : ended ? "לחצו «שיחה חדשה» כדי להתחיל שוב" : "בחרו מקש"}</span>
        )}
      </div>
      <div className="keypad">
        {KEYS.map((key) => (
          <button key={key} type="button" disabled={ended || waiting} onClick={() => press(key)} aria-label={`מקש ${key}`}>
            {key}
          </button>
        ))}
      </div>
      <button type="button" className="hangup" onClick={hangUp} disabled={ended} aria-label="ניתוק">
        <PhoneOff size={20} />
      </button>
    </div>
  );
}
