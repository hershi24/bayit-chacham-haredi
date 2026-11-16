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
    text: "מחייגים למספר המערכת, בוחרים את המכשיר הרצוי ופועלים לפי ההוראות הקוליות. אפשר להדליק, לכבות, לבדוק את מצב המכשיר ולקבוע זמני הפעלה, והכול ללא צורך בסמארטפון.",
  },
  {
    icon: Monitor,
    title: "דרך האתר",
    text: "כל מכשירי החשמל שלכם במקום אחד. רואים אילו מכשירים פועלים, מפעילים ומכבים בלחיצה, ועוקבים אחר מצב החיבור של כל התקן.",
  },
  {
    icon: Clock,
    title: "שעונים ותוכניות אוטומטיות",
    text: "קובעים מראש מתי כל מכשיר יידלק ומתי יכבה. אפשר ליצור תוכניות קבועות, לתכנן חודשים קדימה ולהיערך מראש לשבתות ולמועדי ישראל.",
  },
];

const steps = [
  { title: "מתייעצים ובוחרים", text: "מספרים לנו באילו מכשירי חשמל תרצו לשלוט, ואנחנו מסייעים לכם לבחור את הפתרון המתאים." },
  { title: "מחברים את ההתקן", text: "את השקע החכם מחברים ישירות לשקע החשמל. בקר ללוח החשמל מותקן על ידי חשמלאי מוסמך. אנחנו דואגים לשיוך ההתקן לחשבון שלכם." },
  { title: "מתחילים לשלוט", text: "מקבלים מספר טלפון לחיוג ופרטי כניסה לאתר, ומתחילים ליהנות משליטה נוחה במכשירי החשמל – מכל מקום." },
];

const questions = [
  ["האם צריך סמארטפון כדי להשתמש במערכת?", "לא. ניתן לשלוט במערכת באמצעות שיחת טלפון רגילה, כולל פלאפון כשר וטלפון קווי. בנוסף, ניתן להשתמש באתר דרך מחשב המחובר לאינטרנט."],
  ["מי יכול לשלוט במכשירי החשמל שלי?", "הגישה הטלפונית מוגבלת למספרים שהוגדרו מראש כמורשים. ניתן להוסיף ולהסיר מספרים בהתאם לצורך."],
  ["האם אפשר לתכנן את פעילות המכשירים חודשים מראש?", "בהחלט. אפשר ליצור תוכניות חד־פעמיות או קבועות, לבחור ימים ושעות ולתכנן את פעילות המכשירים חודשים קדימה. כל התוכניות מוצגות בלוח שנה חודשי, כך שניתן לצפות בהן ולערוך אותן בקלות."],
  ["האם אפשר להכין תוכניות לשבתות ולמועדי ישראל?", "כן. ניתן לתכנן מראש זמני הדלקה וכיבוי לקראת שבתות וחגים. לוח השנה כולל תאריכים עבריים, פרשות שבוע וזמני כניסת השבת והחג ויציאתם בהתאם לעיר שנבחרה, ומסייע בהיערכות נוחה מראש. יש להשתמש באפשרויות התזמון בהתאם להנחיות ההלכתיות המקובלות על המשתמש."],
  ["האם נדרש חשמלאי להתקנת המערכת?", "השקע החכם מתחבר לשקע חשמל קיים ואינו דורש התקנה מקצועית. בקר המיועד ללוח החשמל מחייב התקנה על ידי חשמלאי מוסמך."],
  ["מה קורה במקרה של הפסקת חשמל או ניתוק התקשורת?", "מצב ההתקן לאחר חזרת החשמל או התקשורת תלוי בסוג ההתקן ובהגדרותיו. באתר ניתן לבדוק את מצב החיבור ולראות מתי התקבל ממנו עדכון לאחרונה."],
  ["האם ההתקנים עומדים בדרישות התקינה?", "המערכת משתמשת בהתקנים בעלי אישורי תקינה רלוונטיים. ניתן לקבל מידע על האישורים המתאימים לכל דגם לפני הרכישה, בכפוף למסמכי היצרן ולאישורים הקיימים."],
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
        {state === "sending" ? "שולחים" : "אשמח שתחזרו אליי"}
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
                מדליקים את הדוד
                <br />
                <em>בשיחת טלפון.</em>
              </h1>
              <p className="hero-text">
                מתקשרים מהפלאפון הכשר, בוחרים מכשיר ומדליקים או מכבים בלחיצת מקש. אפשר לשלוט גם דרך האתר, לקבוע זמני הפעלה וכיבוי מראש ולתכנן את פעילות מכשירי החשמל אפילו חודשים קדימה – כולל שבתות ומועדי ישראל.
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
                  <ShieldCheck size={17} /> התקנים בעלי אישורי תקינה
                </li>
                <li>
                  <Check size={17} /> שליטה מכל טלפון
                </li>
                <li>
                  <Check size={17} /> תכנון חכם גם חודשים מראש
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
                <span>
                  <Plug size={16} /> שקע חכם · ללא צורך בחשמלאי
                </span>
                <span>
                  <CircuitBoard size={16} /> בקר ללוח החשמל · שלושה ערוצים נפרדים
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
              <h2>שליטה פשוטה. מכל מקום. בדרך שנוחה לכם.</h2>
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
              <h2>כך פשוט לשלוט בבית בשיחת טלפון.</h2>
              <p className="lead">רוצים לראות איך זה עובד? התנסו בהדמיה של שיחה עם המערכת. בחרו מכשיר, בדקו את מצבו וגלו כיצד ניתן להפעיל, לכבות ולתכנן פעולות באמצעות מקשי הטלפון.</p>
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
              <p className="lead muted">בחרו מקש בטלפון והתחילו להתנסות. ההדמיה מציגה בית לדוגמה הכולל דוד, מזגן ותאורת חצר.</p>
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
              <p>כל מכשירי החשמל שלכם מוצגים במקום אחד, בצורה ברורה ונוחה. ניתן לבדוק את מצבם, להפעיל ולכבות מכשירים, לנהל תוכניות ולצפות בפעולות שבוצעו.</p>
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
                  <p>בודקים את מצב החיבור של כל התקן ורואים מתי התקבל ממנו עדכון לאחרונה.</p>
                </div>
              </div>
              <div className="perk reveal">
                <History size={20} />
                <div>
                  <strong>יומן פעולות</strong>
                  <p>צופים בפעולות שבוצעו במערכת, במועד הביצוע ובאופן ההפעלה: דרך הטלפון, האתר או תוכנית אוטומטית.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section tint" id="plans">
          <div className="wrap split plans">
            <div className="reveal">
              <span className="kicker">לוח השעונים</span>
              <h2>מתכננים חודשים קדימה. גם לשבתות ולמועדי ישראל.</h2>
              <p className="lead">מתכננים מראש את פעילות מכשירי החשמל לכל תקופה שתרצו, מיום אחד ועד חודשים קדימה. באמצעות לוח שנה נוח וברור ניתן לקבוע זמני הדלקה וכיבוי, לשלב תוכניות קבועות וחד־פעמיות ולהיערך מראש לשבתות ולמועדי ישראל.</p>
              <p className="lead">כל התוכניות מוצגות בלוח חודשי אחד, לצד התאריך העברי, פרשת השבוע וזמני כניסת השבת והחג ויציאתם, בהתאם לעיר שבחרתם. תוכנית חוזרת מכסה תקופה ארוכה, בלי להגדיר כל יום בנפרד.</p>
              <ul className="plan-points">
                <li>
                  <CalendarDays size={19} />
                  <span>
                    <strong>תכנון לטווח ארוך.</strong> קובעים תוכניות הפעלה וכיבוי שבועות וחודשים מראש, וצופים בכל הפעולות המתוכננות בלוח שנה מסודר.
                  </span>
                </li>
                <li>
                  <Flame size={19} />
                  <span>
                    <strong>תוכניות לשבתות ולמועדי ישראל.</strong> מתכננים מראש את זמני הפעילות לקראת שבתות וחגים, תוך הסתייעות בלוח העברי ובזמני כניסת השבת והחג ויציאתם.
                  </span>
                </li>
                <li>
                  <Repeat size={19} />
                  <span>
                    <strong>גמישות מלאה בתכנון.</strong> משלבים תוכניות חד־פעמיות וקבועות, בוחרים ימים ושעות ומגדירים מספר פעולות לאותו מכשיר בהתאם לצורך.
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
              <h2>הפתרון המתאים לכל צורך.</h2>
            </div>
            <div className="devices">
              <article className="device-card reveal">
                <div className="device-photo">
                  <Image src="/product/socket.webp" width={333} height={440} alt="שקע חכם Kosher Smart Home לקיר" />
                  <span className="tag">ללא צורך בחשמלאי</span>
                </div>
                <h3>שקע חכם</h3>
                <p>שליטה חכמה במכשירי חשמל, ללא צורך בהתקנה מקצועית. מחברים את השקע החכם לשקע החשמל הקיים, מחברים אליו מכשיר מתאים ומתחילים לשלוט בו באמצעות הטלפון או האתר.</p>
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
                <p>פתרון מתקדם לשליטה במערכות חשמל קבועות. הבקר מותקן בלוח החשמל על ידי חשמלאי מוסמך ומאפשר שליטה נפרדת בעד שלושה מעגלי חשמל. לכל מעגל ניתן להגדיר שם, זמני פעילות ותוכניות הפעלה משלו.</p>
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
                המערכת מבוססת על התקנים איכותיים בעלי אישורי תקינה רלוונטיים, שנבחרו תוך הקפדה על אמינות ובטיחות.
              </p>
            </div>
          </div>
        </section>

        <section className="section tint" id="start">
          <div className="wrap">
            <div className="head reveal">
              <span className="kicker">איך מתחילים</span>
              <h2>מתחילים בשלושה צעדים פשוטים.</h2>
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
                <h2>רוצים לדעת אם זה מתאים גם לכם?</h2>
                <p>ספרו לנו באילו מכשירי חשמל תרצו לשלוט, ונשמח לעזור לכם לבחור את הפתרון המתאים. השאירו פרטים ונחזור אליכם בהקדם.</p>
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
            <p>Kosher Smart Home – בית חכם מהפלאפון הכשר. שליטה במכשירי החשמל באמצעות שיחת טלפון, דרך האתר ובאמצעות תוכניות אוטומטיות, עם אפשרות לתכנון מראש גם לשבתות ולמועדי ישראל.</p>
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
