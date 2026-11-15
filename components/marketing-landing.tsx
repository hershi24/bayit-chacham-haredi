"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BrandLogo } from "@/components/brand-logo";
import "./landing.css";

const icons = {
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72l.45 2.81a2 2 0 0 1-.57 1.71L7.1 10.1a16 16 0 0 0 6.8 6.8l1.86-1.89a2 2 0 0 1 1.71-.57l2.81.45A2 2 0 0 1 22 16.92Z" />
  ),
  monitor: (
    <>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  plug: <path d="M12 22v-5m-5-7V3m10 7V3M7 10h10v3a5 5 0 0 1-10 0z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
  layout: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </>
  ),
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  lightbulb: <path d="M9 18h6m-5 4h4M9 14a7 7 0 1 1 6 0l-1 4h-4z" />,
};

function Glyph({ name }: { name: keyof typeof icons }) {
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}

const features: Array<{ icon: keyof typeof icons; title: string; text: string }> = [
  { icon: "phone", title: "שליטה מהפלאפון הכשר", text: "מתקשרים למערכת ומפעילים או מכבים שקע או ערוץ Shelly במקשי הטלפון. בלי סמארטפון ובלי אפליקציה." },
  { icon: "monitor", title: "וגם דרך האתר", text: "נכנסים למערכת ורואים את השקעים ואת ערוצי ה־Shelly במקום אחד, כולל תוכניות ושעונים." },
  { icon: "plug", title: "שקע בלי חשמלאי", text: "בדגם השקע: מחברים לשקע חשמל קיים, משייכים לחשבון ומתחילים. אין צורך בעבודות חשמל." },
  { icon: "globe", title: "שליטה מכל מקום", text: "לא חייבים להיות ליד המכשיר. שולטים מרחוק בשיחת טלפון או באתר, גם על שקע וגם על Shelly." },
  { icon: "layout", title: "ממשק ברור ונוח", text: "שם לכל ערוץ, מצב מחובר או מנותק, וכפתור הפעלה וכיבוי. בלי תפריטים מסובכים." },
  { icon: "layers", title: "גם Shelly Pro 3", text: "שלושה ערוצים נפרדים, כשקע או כלוח חשמל. כל ערוץ נשלט מהטלפון ומהאתר כמו שקע רגיל." },
];

const steps = [
  { title: "מחברים את ההתקן", text: "שקע חכם נכנס לשקע הקיים. Shelly Pro 3 מותקן כשקע או בלוח החשמל, לפי סוג ההתקנה." },
  { title: "משייכים לחשבון", text: "נותנים שם לכל שקע או ערוץ. ב־Shelly Pro 3 מקבלים שלושה ערוצים נפרדים באותו חשבון." },
  { title: "שולטים בדרך שלכם", text: "מפעילים ומכבים בשיחה מהפלאפון הכשר, או באתר: גם מיידית, גם בטיימר, וגם בתוכנית." },
];

const questions = [
  ["אפשר לשלוט בלי סמארטפון?", "כן. שיחה רגילה מהפלאפון הכשר, ומקשי הטלפון מפעילים או מכבים שקע או ערוץ Shelly."],
  ["אפשר לשלוט גם מהמחשב?", "כן. באתר רואים את ההתקנים, מדליקים ומכבים, ומגדירים תוכניות ושעונים."],
  ["צריך חשמלאי?", "לא עבור חיבור דגם השקע לשקע חשמל קיים ותקין. התקנת Shelly בלוח חשמל נעשית על ידי חשמלאי מוסמך."],
  ["האם Shelly נתמך?", "כן. Shelly Pro 3 נתמך במלואו: שלושה ערוצים, שליטה מהטלפון ומהאתר, תוכניות ושעונים. אפשר להתקין אותו כשקע או כלוח חשמל."],
];

export function MarketingLanding({ fontClass, onLogin }: { fontClass: string; onLogin: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [powered, setPowered] = useState(true);
  const year = new Date().getFullYear();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = [...root.querySelectorAll(".reveal")];
    if (reduce || !("IntersectionObserver" in window)) {
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!fine) return;
    const hero = root.querySelector<HTMLElement>(".hero");
    const stage = root.querySelector<HTMLElement>(".product-stage");
    const cards = [...root.querySelectorAll<HTMLElement>(".feature")];
    const cleanups: Array<() => void> = [];
    if (hero && stage) {
      const move = (event: PointerEvent) => {
        const rect = hero.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        hero.style.setProperty("--hx", `${x * 100}%`);
        hero.style.setProperty("--hy", `${y * 100}%`);
        stage.style.transform = `translate3d(${(x - 0.5) * -20}px, ${(y - 0.5) * -18}px, 0) rotateY(${(x - 0.5) * -6}deg) rotateX(${(y - 0.5) * 5}deg)`;
      };
      const leave = () => {
        stage.style.transform = "";
      };
      hero.addEventListener("pointermove", move);
      hero.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        hero.removeEventListener("pointermove", move);
        hero.removeEventListener("pointerleave", leave);
      });
    }
    cards.forEach((card) => {
      const move = (event: PointerEvent) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        card.style.setProperty("--my", `${event.clientY - rect.top}px`);
      };
      card.addEventListener("pointermove", move);
      cleanups.push(() => card.removeEventListener("pointermove", move));
    });
    return () => cleanups.forEach((cleanup) => cleanup());
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
          <a href="#benefits">היתרונות</a>
          <a href="#how">איך זה עובד</a>
          <a href="#control">הדגמה</a>
          <a href="#devices">ההתקנים</a>
          <a className="btn primary" href="#login" onClick={enter}>
            כניסה למערכת ←
          </a>
        </div>
      </nav>
      <main id="top">
        <section className="hero">
          <div className="gridglow" />
          <div className="orb one" />
          <div className="orb two" />
          <div className="ambient-ring ring-one" />
          <div className="ambient-ring ring-two" />
          <span className="spark s1" />
          <span className="spark s2" />
          <span className="spark s3" />
          <span className="spark s4" />
          <div className="wrap hero-grid">
            <div>
              <div className="eyebrow">
                <span className="pulse" /> הבית החכם שמתאים גם לפלאפון כשר
              </div>
              <h1>
                הבית החכם שלך.
                <br />
                <em>במרחק שיחת טלפון.</em>
              </h1>
              <p>
                מדליקים ומכבים שקעים והתקני Shelly מכל מקום — <strong>מהפלאפון הכשר בשיחה רגילה, וגם דרך האתר.</strong> בלי אפליקציה בטלפון. בלי להסתבך.
              </p>
              <div className="actions">
                <a className="btn primary" href="#how">
                  גלו איך זה עובד ←
                </a>
                <a className="btn outline" href="#login" onClick={enter}>
                  כניסה לניהול
                </a>
              </div>
              <div className="tiny">✓ שליטה בשיחה רגילה &nbsp; ✓ ניהול באתר &nbsp; ✓ שקע ללא חשמלאי &nbsp; ✓ Shelly Pro 3</div>
            </div>
            <div className="product-stage">
              <div className="product-glow" />
              <Image
                className="product-img"
                src="/product/socket-phone.gif"
                width={512}
                height={512}
                priority
                unoptimized
                alt="שקע חכם Kosher Smart Home לצד פלאפון כשר לשליטה מרחוק"
              />
            </div>
          </div>
        </section>

        <section className="section alt" id="benefits">
          <div className="wrap">
            <div className="center reveal">
              <span className="kicker">פשוט. חכם. נגיש.</span>
              <h2 className="heading">כל היתרונות. בלי סיבוכים.</h2>
              <p className="sub">הטכנולוגיה עובדת בשבילכם — לא להפך. שליטה פשוטה במכשירים המחוברים, בדרך שמתאימה לכם.</p>
            </div>
            <div className="features">
              {features.map((feature) => (
                <article key={feature.title} className="feature reveal">
                  <div className="ico">
                    <Glyph name={feature.icon} />
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="control">
          <div className="wrap dual">
            <div className="reveal">
              <span className="kicker">תנסו בעצמכם</span>
              <h2 className="heading">
                קליק באתר.
                <br />
                או לחיצה בטלפון.
              </h2>
              <p className="lead">שיחה או אתר, לאותו התקן. נסו להדליק ולכבות בהדגמה — ככה זה מרגיש גם על שקע וגם על ערוץ Shelly.</p>
              <a href="#login" className="btn primary" onClick={enter}>
                כניסה למערכת הניהול ←
              </a>
            </div>
            <div className="demo reveal">
              <div className="demo-top">
                <h3>השקעים שלי</h3>
                <span className="live-dot">● הדגמה</span>
              </div>
              <div className="device">
                <div className="device-icon">
                  <Glyph name="lightbulb" />
                </div>
                <div>
                  <strong>תאורת הסלון</strong>
                  <small>שקע חכם 01</small>
                </div>
                <button type="button" className={powered ? "switch on" : "switch"} aria-label="כיבוי או הפעלת שקע בהדגמה" aria-pressed={powered} onClick={() => setPowered((current) => !current)} />
              </div>
              <div className={powered ? "status on" : "status"} aria-live="polite">
                {powered ? "● השקע פעיל כעת" : "○ השקע כבוי כעת"}
              </div>
              <div className="demo-note">זוהי הדמיה אינטראקטיבית בלבד. אין חיבור למכשיר חשמלי אמיתי.</div>
            </div>
          </div>
        </section>

        <section className="section alt" id="how">
          <div className="wrap">
            <div className="center reveal">
              <span className="kicker">איך מתחילים?</span>
              <h2 className="heading">שלושה צעדים. וזהו.</h2>
              <p className="sub">שקע חכם נכנס לשקע הקיים. Shelly Pro 3 מצטרף כשקע או כלוח, עם שלושה ערוצים.</p>
            </div>
            <div className="steps">
              {steps.map((step, index) => (
                <div key={step.title} className="step reveal">
                  <div className="num">{String(index + 1).padStart(2, "0")}</div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section dark" id="devices">
          <div className="wrap future">
            <div className="reveal future-copy">
              <span className="kicker" style={{ color: "#6ad8ff" }}>
                שני סוגי התקנים
              </span>
              <h2 className="heading">
                שקע חכם.
                <br />
                וגם Shelly Pro 3.
              </h2>
              <p className="sub">אותה מערכת לשניהם: שיחה מהפלאפון הכשר, אתר, טיימר ותוכניות. בוחרים את ההתקן שמתאים לבית.</p>
            </div>
            <div className="future-card reveal">
              <div className="future-mark">
                <Glyph name="layers" />
              </div>
              <h3>Shelly Pro 3 כבר במערכת</h3>
              <p>שלושה ערוצים נפרדים, כל אחד עם שם משלו. אפשר להתקין כשקע או בלוח חשמל. מדליקים ומכבים מהטלפון ומהאתר, ורואים אם ההתקן מחובר.</p>
            </div>
          </div>
        </section>

        <section className="section alt" id="faq">
          <div className="wrap">
            <div className="center">
              <span className="kicker">שאלות נפוצות</span>
              <h2 className="heading">שאלות פשוטות. תשובות ברורות.</h2>
            </div>
            <div className="faq">
              {questions.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="contact">
          <div className="wrap">
            <div className="cta reveal">
              <h2>מוכנים לבית חכם באמת?</h2>
              <p>בלי אפליקציה בטלפון. בלי התקנה מסובכת. השליטה בידיים שלכם.</p>
              <a className="btn" href="#login" onClick={enter}>
                כבר לקוחות? היכנסו למערכת ←
              </a>
              <p className="fine">מעוניינים לרכוש? פרטי יצירת קשר והזמנה יתווספו כאן לפני הפרסום.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="wrap">
          <div>
            <strong>Kosher Smart Home</strong>
            <br />
            בית חכם מהפלאפון הכשר
          </div>
          <div>© {year} Kosher Smart Home · כל הזכויות שמורות</div>
        </div>
      </footer>
    </div>
  );
}
