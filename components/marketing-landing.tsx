"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  CircuitBoard,
  Clock,
  Coffee,
  Flame,
  History,
  Lightbulb,
  LoaderCircle,
  Mail,
  Monitor,
  Phone,
  PhoneCall,
  Plug,
  RotateCcw,
  Send,
  ShieldCheck,
  Snowflake,
  WifiOff,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import "./landing.css";

const PHONE = "058-329-6967";
const PHONE_HREF = "tel:+972583296967";
const EMAIL = "e0583296967@gmail.com";

const uses = [
  { icon: Flame, label: "דוד שמש" },
  { icon: Snowflake, label: "מזגנים" },
  { icon: Lightbulb, label: "תאורה" },
  { icon: Coffee, label: "פלטה ומיחם" },
  { icon: Zap, label: "מעגלים בלוח החשמל" },
];

const ways = [
  {
    icon: PhoneCall,
    title: "שיחה מהפלאפון הכשר",
    text: "מחייגים למספר של המערכת. היא מקריאה את המכשירים שלכם בשמות, ואתם מקישים מה להדליק ומה לכבות.",
  },
  {
    icon: Monitor,
    title: "מהמחשב",
    text: "כל המכשירים במסך אחד. רואים מה דולק, מה כבוי, ומתי כל מכשיר היה מחובר בפעם האחרונה.",
  },
  {
    icon: Clock,
    title: "שעונים ותוכניות",
    text: "הדוד נדלק כל בוקר בשש, המזגן כבה בחצות. קובעים פעם אחת, והמערכת כבר זוכרת לבד.",
  },
];

const steps = [
  { title: "מדברים", text: "מתקשרים או משאירים פרטים. מספרים לנו מה רוצים לשלוט, ואנחנו ממליצים על ההתקן המתאים." },
  { title: "מתקינים", text: "שקע חכם נכנס לקיר תוך דקה. בקר ללוח החשמל מתקין חשמלאי. אנחנו מחברים הכל לחשבון שלכם." },
  { title: "שולטים", text: "מקבלים מספר לחיוג ופרטי כניסה לאתר. מאותו רגע הבית בידיים שלכם." },
];

const questions = [
  ["צריך סמארטפון?", "לא. כל טלפון שיכול להתקשר מתאים, כולל פלאפון כשר וטלפון קווי."],
  ["מי יכול להתקשר למערכת?", "רק מספרים שאישרתם מראש. אפשר להוסיף את הטלפון של בן או בת הזוג, ולהסיר מתי שרוצים."],
  ["אפשר לקבוע שמכשיר יידלק לבד?", "כן. טיימר חד־פעמי, שעון יומי, או תוכנית לימים מסוימים בשבוע. קובעים באתר וגם בשיחה."],
  ["צריך חשמלאי?", "לשקע החכם לא, הוא נכנס לשקע הקיים. בקר ללוח החשמל מתקין חשמלאי מוסמך."],
  ["מה קורה אם נפל החשמל או האינטרנט?", "כשהחיבור חוזר, ההתקן חוזר לעבוד. באתר רואים מתי בדיוק הוא היה מחובר בפעם האחרונה."],
  ["המוצרים מאושרים?", "כן. כל ההתקנים שאנחנו מספקים נושאים תו תקן ועומדים בדרישות הרשויות בישראל."],
];

type Line = { from: "sys" | "me"; text: string };
type CallStep = "menu" | "device" | "done";

const callDevices: Record<string, string> = { "1": "דוד שמש", "2": "המזגן בסלון", "3": "התאורה בחצר" };
const greeting: Line = { from: "sys", text: "שלום. לדוד שמש הקש 1, למזגן בסלון הקש 2, לתאורה בחצר הקש 3." };

function CallDemo() {
  const [lines, setLines] = useState<Line[]>([greeting]);
  const [step, setStep] = useState<CallStep>("menu");
  const [device, setDevice] = useState<string | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const screen = screenRef.current;
    if (screen) screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" });
  }, [lines]);

  function press(key: string) {
    if (step === "done") return;
    const mine: Line = { from: "me", text: key };
    if (step === "menu") {
      const name = callDevices[key];
      if (!name) return setLines((all) => [...all, mine, { from: "sys", text: "הבחירה לא קיימת. נסו 1, 2 או 3." }]);
      setDevice(name);
      setStep("device");
      return setLines((all) => [...all, mine, { from: "sys", text: `${name} כבוי כעת. להפעלה הקש 1, להפעלה לשעה הקש 2.` }]);
    }
    if (key === "1") {
      setStep("done");
      return setLines((all) => [...all, mine, { from: "sys", text: `${device} הופעל. להתראות.` }]);
    }
    if (key === "2") {
      setStep("done");
      return setLines((all) => [...all, mine, { from: "sys", text: `${device} הופעל, ויכבה לבד בעוד שעה.` }]);
    }
    setLines((all) => [...all, mine, { from: "sys", text: "להפעלה הקש 1, להפעלה לשעה הקש 2." }]);
  }

  function restart() {
    setLines([greeting]);
    setStep("menu");
    setDevice(null);
  }

  return (
    <div className="phone">
      <div className="phone-head">
        <span className="phone-dot" />
        <span>בשיחה עם הבית</span>
        <span className="phone-time" dir="ltr">
          00:{String(Math.min(59, lines.length * 4)).padStart(2, "0")}
        </span>
      </div>
      <div className="phone-screen" ref={screenRef} aria-live="polite">
        {lines.map((line, index) => (
          <p key={index} className={line.from === "me" ? "bubble me" : "bubble"}>
            {line.from === "me" ? `הקשתם ${line.text}` : line.text}
          </p>
        ))}
        {step === "done" ? (
          <button type="button" className="restart" onClick={restart}>
            <RotateCcw size={15} /> שיחה חדשה
          </button>
        ) : null}
      </div>
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((key) => (
          <button key={key} type="button" disabled={step === "done"} onClick={() => press(key)} aria-label={`מקש ${key}`}>
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContactForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, message, website }),
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "השליחה לא עברה");
      setState("sent");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof Error ? cause.message : "השליחה לא עברה");
    }
  }

  if (state === "sent") {
    return (
      <div className="form sent">
        <div className="sent-mark">
          <Check size={28} />
        </div>
        <h3>תודה, {name.split(" ")[0]}.</h3>
        <p>קיבלנו את הפרטים ונחזור אליכם בהקדם.</p>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>שם</span>
        <input required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="איך לפנות אליכם" />
      </label>
      <label>
        <span>טלפון</span>
        <input required type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="050-0000000" />
      </label>
      <label>
        <span>מה תרצו לשלוט? <em>(לא חובה)</em></span>
        <textarea rows={3} maxLength={600} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="למשל: דוד שמש ושני מזגנים" />
      </label>
      <input className="trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(event) => setWebsite(event.target.value)} />
      {error ? (
        <p className="form-error">
          {error}. אפשר גם להתקשר: <a href={PHONE_HREF}>{PHONE}</a>
        </p>
      ) : null}
      <button type="submit" className="btn primary wide" disabled={state === "sending"}>
        {state === "sending" ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
        {state === "sending" ? "שולחים" : "חזרו אליי"}
      </button>
    </form>
  );
}

export function MarketingLanding({ fontClass, onLogin }: { fontClass: string; onLogin: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll(".reveal")];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      nodes.forEach((node) => node.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  function enter(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    onLogin();
  }

  return (
    <div ref={rootRef} className={`ksh-landing ${fontClass}`}>
      <nav className="nav">
        <a className="brand" href="#top">
          <BrandLogo className="brand-logo" />
        </a>
        <div className="navlinks">
          <a href="#how">איך זה עובד</a>
          <a href="#inside">מבפנים</a>
          <a href="#devices">ההתקנים</a>
          <a href="#faq">שאלות</a>
          <a href="#contact">צור קשר</a>
        </div>
        <div className="nav-actions">
          <a className="nav-phone" href={PHONE_HREF} dir="ltr">
            <Phone size={16} /> {PHONE}
          </a>
          <a className="btn dark small" href="#login" onClick={enter}>
            כניסה ללקוחות
          </a>
        </div>
      </nav>

      <main id="top">
        <section className="hero">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="pulse" /> בית חכם, גם בלי סמארטפון
              </span>
              <h1>
                מדליקים את הדוד
                <br />
                <em>בשיחת טלפון.</em>
              </h1>
              <p className="hero-text">
                מתקשרים מהפלאפון הכשר, מקישים מספר, והמזגן, הדוד או התאורה נדלקים. אפשר גם מהמחשב, ואפשר לקבוע שעון שיעשה את זה בשבילכם.
              </p>
              <div className="actions">
                <a className="btn primary" href="#contact">
                  השאירו פרטים <ArrowLeft size={18} />
                </a>
                <a className="btn ghost" href={PHONE_HREF}>
                  <Phone size={18} /> <span dir="ltr">{PHONE}</span>
                </a>
              </div>
              <ul className="trust">
                <li>
                  <ShieldCheck size={17} /> מוצרים עם תו תקן
                </li>
                <li>
                  <Check size={17} /> עובד מכל טלפון
                </li>
                <li>
                  <Check size={17} /> שעונים ותוכניות קבועות
                </li>
              </ul>
            </div>
            <div className="hero-art">
              <div className="art-card">
                <Image
                  className="product-img"
                  src="/product/socket-phone.gif"
                  width={512}
                  height={512}
                  priority
                  unoptimized
                  alt="שקע חכם לצד פלאפון כשר"
                />
              </div>
              <div className="chip chip-a">
                <span className="chip-dot on" />
                <div>
                  <strong>דוד שמש</strong>
                  <small>נדלק ב־06:00 · לפי שעון</small>
                </div>
              </div>
              <div className="chip chip-b">
                <PhoneCall size={18} />
                <div>
                  <strong>הקש 1 להפעלה</strong>
                  <small>המזגן בסלון</small>
                </div>
              </div>
            </div>
          </div>
          <div className="wrap uses reveal">
            <span>מה מחברים?</span>
            {uses.map(({ icon: Icon, label }) => (
              <span key={label} className="use">
                <Icon size={17} /> {label}
              </span>
            ))}
          </div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">שלוש דרכים לשלוט</span>
              <h2>בטלפון, באתר, או שזה קורה לבד.</h2>
            </div>
            <div className="ways">
              {ways.map(({ icon: Icon, title, text }, index) => (
                <article key={title} className={`way reveal tone-${index}`}>
                  <div className="way-icon">
                    <Icon size={26} />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section tint" id="call">
          <div className="wrap split">
            <div className="reveal">
              <span className="kicker">נסו בעצמכם</span>
              <h2>ככה נשמעת שיחה.</h2>
              <p className="lead">בלי אפליקציה ובלי תפריטים ארוכים. המערכת קוראת לכל מכשיר בשם שנתתם לו, ואומרת בדיוק מה להקיש.</p>
              <p className="lead muted">לחצו על המקשים בטלפון שבצד ותראו איך זה מרגיש.</p>
            </div>
            <div className="reveal">
              <CallDemo />
            </div>
          </div>
        </section>

        <section className="section" id="inside">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">מבפנים</span>
              <h2>מסך אחד, כל הבית.</h2>
              <p>ככה נראה החשבון שלכם באתר. כל מכשיר עם שם, מצב ושעון, ובלחיצה על «כבה הכל» יוצאים מהבית רגועים.</p>
            </div>
            <figure className="browser reveal">
              <div className="browser-bar">
                <span />
                <span />
                <span />
                <div className="browser-url" dir="ltr">
                  kosher-smart-home
                </div>
              </div>
              <Image src="/product/dashboard.webp" width={1600} height={902} alt="מסך הבית במערכת: מזגנים, דוד ותאורה עם מצב ומתג לכל אחד" className="browser-img" />
            </figure>
            <div className="perks">
              <div className="perk reveal">
                <Zap size={20} />
                <div>
                  <strong>רואים מה דולק</strong>
                  <p>ירוק זה פועל. אין מה לנחש.</p>
                </div>
              </div>
              <div className="perk reveal">
                <WifiOff size={20} />
                <div>
                  <strong>יודעים מתי נותק</strong>
                  <p>אם מכשיר לא מחובר, רואים מתי היה מחובר לאחרונה.</p>
                </div>
              </div>
              <div className="perk reveal">
                <History size={20} />
                <div>
                  <strong>יומן פעולות</strong>
                  <p>מי הדליק, מתי, ומאיפה: שיחה, אתר או שעון.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section tint" id="devices">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">ההתקנים</span>
              <h2>שני סוגים. בוחרים מה מתאים לבית.</h2>
            </div>
            <div className="devices">
              <article className="device-card reveal">
                <div className="device-top">
                  <div className="device-icon">
                    <Plug size={28} />
                  </div>
                  <span className="tag">בלי חשמלאי</span>
                </div>
                <h3>שקע חכם</h3>
                <p>נכנס לשקע שבקיר, והמכשיר מתחבר אליו. מתאים לכל מה שעובד משקע רגיל, לפי מגבלת ההספק.</p>
                <ul>
                  <li>
                    <Check size={16} /> מתקינים לבד תוך דקה
                  </li>
                  <li>
                    <Check size={16} /> מתאים לפלטה, מיחם, מנורה ותנור
                  </li>
                </ul>
              </article>
              <article className="device-card reveal">
                <div className="device-top">
                  <div className="device-icon">
                    <CircuitBoard size={28} />
                  </div>
                  <span className="tag">שלושה ערוצים</span>
                </div>
                <h3>בקר ללוח החשמל</h3>
                <p>מותקן בלוח ושולט בעד שלושה מעגלים נפרדים. כל ערוץ מקבל שם משלו ונשלט בנפרד.</p>
                <ul>
                  <li>
                    <Check size={16} /> דוד, מזגן מרכזי, תאורת חוץ
                  </li>
                  <li>
                    <Check size={16} /> התקנה על ידי חשמלאי מוסמך
                  </li>
                </ul>
              </article>
            </div>
            <div className="cert reveal">
              <ShieldCheck size={26} />
              <p>
                <strong>כל המוצרים נושאים תו תקן</strong> ועומדים בדרישות הרשויות בישראל.
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="start">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">איך מתחילים</span>
              <h2>שלושה צעדים, ואתם בפנים.</h2>
            </div>
            <ol className="steps">
              {steps.map((step, index) => (
                <li key={step.title} className="step reveal">
                  <span className="num">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section tint" id="faq">
          <div className="wrap narrow">
            <div className="head reveal">
              <span className="kicker">שאלות נפוצות</span>
              <h2>מה שבדרך כלל שואלים אותנו.</h2>
            </div>
            <div className="faq">
              {questions.map(([question, answer]) => (
                <details key={question} className="reveal">
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="contact">
          <div className="wrap">
            <div className="contact reveal">
              <div className="contact-copy">
                <span className="kicker light">צור קשר</span>
                <h2>רוצים לשמוע עוד?</h2>
                <p>השאירו שם וטלפון ונחזור אליכם. מעדיפים לדבר עכשיו? אנחנו על הקו.</p>
                <a className="contact-line" href={PHONE_HREF}>
                  <span className="contact-icon">
                    <Phone size={20} />
                  </span>
                  <span dir="ltr">{PHONE}</span>
                </a>
                <a className="contact-line" href={`mailto:${EMAIL}`}>
                  <span className="contact-icon">
                    <Mail size={20} />
                  </span>
                  <span dir="ltr">{EMAIL}</span>
                </a>
              </div>
              <ContactForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-grid">
          <div className="footer-brand">
            <strong className="footer-name">Kosher Smart Home</strong>
            <p>שליטה במכשירי החשמל בבית מהפלאפון הכשר ומהאתר.</p>
            <a className="footer-phone" href={PHONE_HREF} dir="ltr">
              {PHONE}
            </a>
            <p className="footer-note">התקשרו או השאירו פרטים, ונחזור אליכם.</p>
          </div>
          <div>
            <h4>מה שולטים</h4>
            <ul>
              <li>דוד שמש</li>
              <li>מזגנים</li>
              <li>תאורה בבית ובחצר</li>
              <li>פלטה ומיחם</li>
              <li>מעגלים בלוח החשמל</li>
            </ul>
          </div>
          <div>
            <h4>באתר</h4>
            <ul>
              <li>
                <a href="#how">איך זה עובד</a>
              </li>
              <li>
                <a href="#inside">מבפנים</a>
              </li>
              <li>
                <a href="#devices">ההתקנים</a>
              </li>
              <li>
                <a href="#faq">שאלות נפוצות</a>
              </li>
              <li>
                <a href="#contact">צור קשר</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>לקוחות קיימים</h4>
            <ul>
              <li>
                <a href="#login" onClick={enter}>
                  כניסה למערכת
                </a>
              </li>
              <li>
                טלפון: <a href={PHONE_HREF} dir="ltr">{PHONE}</a>
              </li>
              <li>
                <a href={`mailto:${EMAIL}`} dir="ltr">
                  {EMAIL}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="wrap footer-bottom">
          <span>© {year} Kosher Smart Home</span>
          <span>כל המוצרים עם תו תקן</span>
        </div>
      </footer>

      <a className="float-call" href={PHONE_HREF} aria-label={`התקשרו ${PHONE}`}>
        <Phone size={22} />
      </a>
    </div>
  );
}
