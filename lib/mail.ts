export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim());
}

export async function sendPasswordReset(to: string, url: string) {
  const key = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.MAIL_FROM?.trim() ?? "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "איפוס סיסמה — Kosher Smart Home",
      text: `לאיפוס הסיסמה היכנסו לקישור. הוא תקף לחצי שעה:\n${url}\n\nאם לא ביקשתם איפוס, אפשר להתעלם מההודעה.`,
    }),
  });
  if (!response.ok) throw new Error("שליחת הדוא״ל נכשלה");
}
