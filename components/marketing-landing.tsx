"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  CalendarDays,
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
  Repeat,
  Send,
  ShieldCheck,
  Snowflake,
  WifiOff,
  Zap,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CallDemo } from "@/components/call-demo";
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
    title: "מהפלאפון הכשר",
    text: "מחייגים למספר המערכת ובוחרים את המכשיר. במקשים מדליקים, מכבים, בודקים את מצב המכשיר וקובעים זמני הפעלה. ברשימת המכשירים אפשר גם ללחוץ כוכבית ולומר, למשל, «תדליק את המזגן» או «תדליק את הדוד לחצי שעה».",
  },
  {
    icon: Monitor,
    title: "דרך האתר",
    text: "כל המכשירים המחוברים למערכת מוצגים במקום אחד. בודקים מה פועל, מדליקים ומכבים בלחיצה ועוקבים אחר מצב החיבור של כל התקן.",
  },
  {
    icon: Clock,
    title: "שעונים ותוכניות אוטומטיות",
    text: "מגדירים מראש זמני הדלקה וכיבוי, יוצרים תוכניות חד־פעמיות או קבועות ונותנים למערכת לבצע את הפעולות בזמן שנקבע – גם בשגרה וגם בתכנון מראש לשבתות ולמועדי ישראל.",
  },
];

const steps = [
  { title: "מתייעצים ובוחרים", text: "ספרו לנו באילו מכשירים תרצו לשלוט, ונעזור לכם לבחור את ההתקן המתאים לצרכים שלכם." },
  { title: "מחברים את ההתקן", text: "השקע החכם מתחבר ישירות לשקע החשמל, ללא צורך בחשמלאי. בקר ללוח החשמל מותקן על ידי חשמלאי מוסמך. אנחנו דואגים לשייך את ההתקן לחשבון שלכם." },
  { title: "מתחילים לשלוט", text: "מקבלים מספר טלפון ופרטי גישה לאתר, ומתחילים לשלוט במכשירי החשמל בקלות – מהבית או מרחוק." },
];

const questions = [
  ["האם צריך סמארטפון כדי להשתמש במערכת?", "ממש לא. המערכת מיועדת לפעול גם באמצעות פלאפון כשר או טלפון קווי, ללא צורך בסמארטפון. אפשר לשלוט במכשירים גם דרך האתר, באמצעות מחשב המחובר לאינטרנט."],
  ["אפשר לדבר במקום להקיש?", "כן. ברשימת המכשירים מקישים כוכבית, שומעים «דבר אליי», ואומרים למשל «תדליק את המזגן בסלון», «כבה את הדוד» או «תדליק את הדוד לחצי שעה». המערכת מבצעת את הפעולה וחוזרת למקשים. אם המשפט לא ברור, או אם מבקשים להפעיל את כל המכשירים יחד, היא לא מפעילה כלום."],
  ["מי יכול לשלוט במכשירי החשמל שלי?", "הגישה הטלפונית מוגבלת למספרים שהוגדרו מראש כמורשים. ניתן להוסיף ולהסיר מספרים בהתאם לצורך."],
  ["האם אפשר לתכנן את פעילות המכשירים חודשים מראש?", "בהחלט. אפשר לקבוע תוכניות חד־פעמיות וקבועות, לתכנן זמני הפעלה וכיבוי חודשים מראש ולנהל את כל התוכניות בלוח שנה חודשי. תוכניות חוזרות מאפשרות לתכנן פעילות ממושכת בלי להגדיר כל יום מחדש."],
  ["האם אפשר להכין תוכניות לשבתות ולמועדי ישראל?", "כן. ניתן להכין מראש תוכניות הפעלה וכיבוי לשבתות ולמועדי ישראל, ולהסתייע בלוח השנה העברי ובזמני כניסת השבת והחג ויציאתם בהתאם לעיר שנבחרה. כך אפשר להיערך בנוחות מראש, בהתאם להנחיות ההלכתיות המקובלות עליכם."],
  ["האם נדרש חשמלאי להתקנת המערכת?", "השקע החכם מתחבר לשקע חשמל קיים ואינו דורש התקנה מקצועית. בקר המיועד ללוח החשמל מחייב התקנה על ידי חשמלאי מוסמך."],
  ["מה קורה אם יש הפסקת חשמל או תקלה בתקשורת?", "מצב ההתקן לאחר חזרת החשמל או התקשורת תלוי בסוג ההתקן ובהגדרותיו. באתר ניתן לבדוק את מצב החיבור ולראות מתי התקבל ממנו עדכון לאחרונה."],
  ["האם ההתקנים עומדים בדרישות התקינה?", "המערכת מבוססת על התקנים בעלי אישורי תקינה רלוונטיים. נשמח למסור מידע על האישורים והתקנים החלים על כל דגם לפני הרכישה."],
];

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
        <span>מספר טלפון</span>
        <input required type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="050-0000000" />
      </label>
      <label>
        <span>באילו מכשירים תרצו לשלוט? <em>(לא חובה)</em></span>
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
        {state === "sending" ? "שולחים" : "השאירו פרטים ונחזור אליכם"}
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
          <a href="#inside">הצצה למערכת</a>
          <a href="#plans">לוח השעונים</a>
          <a href="#devices">ההתקנים</a>
          <a href="#faq">שאלות נפוצות</a>
          <a href="#contact">יצירת קשר</a>
        </div>
        <div className="nav-actions">
          <a className="nav-phone" href={PHONE_HREF} dir="ltr">
            <Phone size={16} /> {PHONE}
          </a>
          <a className="btn dark small" href="#login" onClick={enter}>
            כניסה למערכת
          </a>
        </div>
      </nav>

      <main id="top">
        <section className="hero">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="pulse" /> בית חכם, גם בלי סמארטפון
              </span>
              <h1>
                <span>מי אמר שבית חכם</span>
                <em>צריך סמארטפון?</em>
              </h1>
              <div className="hero-lead">
                <p>
                  <span className="lead-q">שמעתם על בית חכם, אבל חשבתם שחייבים בשבילו סמארטפון?</span>
                  <span className="lead-a">הגיע הזמן להכיר דרך אחרת.</span>
                </p>
                <p>הכירו בית חכם שמתאים לאורח החיים שלכם. מדליקים את המזגן עוד בדרך הביתה, שולטים בדוד ובתאורה ומתכננים מראש את פעילות מכשירי החשמל – גם חודשים קדימה, לשבתות ולמועדי ישראל.</p>
                <p>והכול בשיחת טלפון פשוטה מהפלאפון הכשר, במקשים או בדיבור, או בנוחות דרך האתר.</p>
              </div>
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
                  <ShieldCheck size={17} /> התקנים בעלי אישורי תקינה
                </li>
                <li>
                  <Check size={17} /> שליטה מכל טלפון
                </li>
                <li>
                  <Check size={17} /> תכנון חודשים קדימה
                </li>
              </ul>
            </div>
            <figure className="hero-art">
              <div className="hero-glow" />
              <Image
                className="hero-devices"
                src="/product/devices.webp"
                width={561}
                height={505}
                priority
                alt="שני ההתקנים: שקע חכם לקיר ובקר תלת־ערוצי ללוח החשמל"
              />
              <figcaption>
                <span className="device-note">
                  <Plug size={18} />
                  <span>
                    <b>שקע חכם</b>
                    <small>ללא צורך בחשמלאי</small>
                  </span>
                </span>
                <span className="device-note">
                  <CircuitBoard size={18} />
                  <span>
                    <b>בקר ללוח החשמל</b>
                    <small>שליטה בשלושה מעגלים</small>
                  </span>
                </span>
              </figcaption>
            </figure>
          </div>
          <div className="wrap uses reveal">
            <span>במה אפשר לשלוט?</span>
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
              <h2>הבית בשליטה שלכם. בדרך שנוחה לכם.</h2>
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
              <h2>כך נשמעת השליטה בבית החכם.</h2>
              <p className="lead">רוצים לגלות כמה זה פשוט? התנסו בשיחה לדוגמה עם המערכת: בחרו מכשיר, בדקו אם הוא פועל ונסו להדליק, לכבות או לקבוע זמני הפעלה באמצעות מקשי הטלפון. בשיחה אמיתית, כוכבית ברשימת המכשירים אומרת «דבר אליי», ואפשר לומר הדלקה, כיבוי, בדיקת מצב או טיימר.</p>
              <ul className="call-map">
                <li>
                  <b>1</b> הדלקה וכיבוי
                </li>
                <li>
                  <b>2</b> הפעלה או כיבוי באמצעות טיימר
                </li>
                <li>
                  <b>3</b> קביעת שעון חד־פעמי או קבוע
                </li>
                <li>
                  <b>4</b> צפייה בתוכניות קיימות ועריכתן
                </li>
                <li>
                  <b>0</b> הגדרות ואפשרויות נוספות
                </li>
              </ul>
              <p className="lead muted">לחצו על אחד ממקשי הטלפון והתנסו בשליטה בדוד, במזגן ובתאורת החצר של הבית לדוגמה.</p>
            </div>
            <div className="reveal">
              <CallDemo />
            </div>
          </div>
        </section>

        <section className="section" id="inside">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">הצצה למערכת</span>
              <h2>מסך אחד, כל הבית.</h2>
              <p>כל המכשירים המחוברים למערכת מוצגים במסך אחד, בצורה ברורה ונוחה. בודקים מה פועל, שולטים בכל מכשיר בנפרד, מנהלים תוכניות הפעלה וצופים בהיסטוריית הפעולות.</p>
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
                  <strong>רואים מה פועל</strong>
                  <p>יודעים במבט אחד אילו מכשירים דולקים ואילו כבויים, ושולטים בכל מכשיר בנפרד.</p>
                </div>
              </div>
              <div className="perk reveal">
                <WifiOff size={20} />
                <div>
                  <strong>מעקב אחר חיבור ההתקנים</strong>
                  <p>רואים אילו התקנים מחוברים למערכת ומתי התקבל העדכון האחרון מכל התקן.</p>
                </div>
              </div>
              <div className="perk reveal">
                <History size={20} />
                <div>
                  <strong>יומן פעולות</strong>
                  <p>צופים בהיסטוריית ההפעלות והכיבויים, כולל מועד הביצוע ודרך ההפעלה – בשיחת טלפון, דרך האתר או באמצעות תוכנית אוטומטית.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section tint" id="plans">
          <div className="wrap split plans">
            <div className="reveal">
              <span className="kicker">לוח השעונים</span>
              <h2>מתכננים מראש. לכל השבוע, לשבת ולמועדי ישראל.</h2>
              <p className="lead">לוח השעונים מאפשר לתכנן את פעילות מכשירי החשמל ימים, שבועות ואפילו חודשים מראש. קובעים זמני הדלקה וכיבוי, משלבים תוכניות קבועות וחד־פעמיות ומכינים מראש את הפעילות הרצויה גם לשבתות ולמועדי ישראל.</p>
              <p className="lead">כל התוכניות מוצגות בלוח שנה חודשי, לצד התאריך העברי, פרשת השבוע וזמני כניסת השבת והחג ויציאתם, בהתאם לעיר שנבחרה. באמצעות תוכניות חוזרות אפשר לתכנן פעילות לתקופות ממושכות, בלי להגדיר מחדש כל יום בנפרד.</p>
              <ul className="plan-points">
                <li>
                  <CalendarDays size={19} />
                  <span>
                    <strong>תכנון לטווח ארוך.</strong> מתכננים זמני הפעלה וכיבוי גם חודשים קדימה, וכל הפעולות המתוכננות מוצגות בלוח שנה ברור ומסודר.
                  </span>
                </li>
                <li>
                  <Flame size={19} />
                  <span>
                    <strong>תוכניות לשבתות ולמועדי ישראל.</strong> נערכים מראש לשבתות ולמועדי ישראל בעזרת תוכניות הפעלה מתוזמנות, לוח עברי וזמני כניסת השבת והחג ויציאתם.
                  </span>
                </li>
                <li>
                  <Repeat size={19} />
                  <span>
                    <strong>גמישות מלאה בתכנון.</strong> יוצרים תוכניות חד־פעמיות או קבועות, בוחרים את הימים והשעות הרצויים ומשלבים מספר זמני הפעלה וכיבוי לכל מכשיר.
                  </span>
                </li>
              </ul>
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
              <Image
                src="/product/planner.webp"
                width={720}
                height={756}
                alt="לוח השעונים: חודש עברי ולועזי, שעוני הדלקה וכיבוי, זמני כניסת שבת ויציאתה"
                className="browser-img"
              />
            </figure>
          </div>
        </section>

        <section className="section" id="devices">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">ההתקנים שלנו</span>
              <h2>פתרון חכם שמתאים לצרכים שלכם.</h2>
            </div>
            <div className="devices">
              <article className="device-card reveal">
                <div className="device-photo">
                  <Image src="/product/socket.webp" width={333} height={440} alt="שקע חכם Kosher Smart Home לקיר" />
                  <span className="tag">ללא צורך בחשמלאי</span>
                </div>
                <h3>שקע חכם</h3>
                <p>הופכים מכשיר חשמלי מתאים למכשיר שניתן לשלוט בו מרחוק – בלי התקנה מורכבת ובלי צורך בחשמלאי. פשוט מחברים את השקע החכם לשקע החשמל, מחברים אליו את המכשיר ומתחילים לשלוט באמצעות הטלפון או האתר.</p>
                <ul>
                  <li>
                    <Check size={16} /> <span>חיבור פשוט, ללא צורך בחשמלאי</span>
                  </li>
                  <li>
                    <Check size={16} /> <span>שליטה מרחוק וקביעת זמני הפעלה וכיבוי</span>
                  </li>
                  <li>
                    <Check size={16} /> <span>מתאים למכשירי חשמל בהתאם לנתוני ההספק והעומס המותרים</span>
                  </li>
                </ul>
              </article>
              <article className="device-card reveal">
                <div className="device-photo">
                  <Image src="/product/controller.webp" width={333} height={440} alt="בקר Kosher Smart Home ללוח החשמל, שלושה ערוצים" />
                  <span className="tag">שלושה ערוצים</span>
                </div>
                <h3>בקר חכם ללוח החשמל</h3>
                <p>בקר חכם לשליטה במערכות חשמל קבועות, כגון דוד, מיזוג ותאורה. הבקר מותקן בלוח החשמל על ידי חשמלאי מוסמך ומאפשר שליטה עצמאית בעד שלושה מעגלים, עם תוכניות הפעלה וזמני פעילות נפרדים לכל מעגל.</p>
                <ul>
                  <li>
                    <Check size={16} /> <span>שליטה נפרדת בעד שלושה מעגלי חשמל</span>
                  </li>
                  <li>
                    <Check size={16} /> <span>מתאים למערכות כגון דוד, מיזוג ותאורה</span>
                  </li>
                  <li>
                    <Check size={16} /> <span>התקנה מקצועית על ידי חשמלאי מוסמך</span>
                  </li>
                </ul>
              </article>
            </div>
            <div className="cert reveal">
              <ShieldCheck size={26} />
              <p>
                המערכת מבוססת על התקנים של יצרנים מוכרים, בעלי אישורי תקינה רלוונטיים, תוך הקפדה על איכות, אמינות והתאמה לצורכי השימוש.
              </p>
            </div>
          </div>
        </section>

        <section className="section tint" id="start">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">איך מתחילים</span>
              <h2>שלושה צעדים, והבית שלכם חכם.</h2>
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

        <section className="section" id="faq">
          <div className="wrap narrow">
            <div className="head reveal">
              <span className="kicker">שאלות נפוצות</span>
              <h2>כל מה שחשוב לדעת.</h2>
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

        <section className="section tint" id="contact">
          <div className="wrap">
            <div className="contact reveal">
              <div className="contact-copy">
                <span className="kicker light">יצירת קשר</span>
                <h2>רוצים בית חכם שמתאים בדיוק לכם?</h2>
                <p>ספרו לנו מה תרצו להפעיל ולנהל מרחוק, ונעזור לכם למצוא את הפתרון המתאים לבית שלכם. השאירו פרטים ונחזור אליכם בהקדם.</p>
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
            <p>Kosher Smart Home – בית חכם מהפלאפון הכשר.</p>
            <p>שליטה נוחה במכשירי החשמל בשיחת טלפון, במקשים או בדיבור, או דרך האתר, לצד תוכניות הפעלה אוטומטיות ותכנון מראש לשבתות ולמועדי ישראל.</p>
            <a className="footer-phone" href={PHONE_HREF} dir="ltr">
              {PHONE}
            </a>
            <p className="footer-note">התקשרו או השאירו פרטים, ונחזור אליכם.</p>
          </div>
          <div>
            <h4>במה אפשר לשלוט?</h4>
            <ul>
              <li>דוד שמש</li>
              <li>מזגנים</li>
              <li>תאורה בבית ובחצר</li>
              <li>פלטה ומיחם (בהתאם להתאמת ההתקן)</li>
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
                <a href="#inside">הצצה למערכת</a>
              </li>
              <li>
                <a href="#plans">לוח השעונים</a>
              </li>
              <li>
                <a href="#devices">ההתקנים</a>
              </li>
              <li>
                <a href="#faq">שאלות נפוצות</a>
              </li>
              <li>
                <a href="#contact">יצירת קשר</a>
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
          <span>התקנים בעלי אישורי תקינה</span>
        </div>
      </footer>

      <a className="float-call" href={PHONE_HREF} aria-label={`התקשרו ${PHONE}`}>
        <Phone size={22} />
      </a>
    </div>
  );
}
