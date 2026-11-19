const DEFAULT_SITE_URL = "https://bayit-chacham-haredi.onrender.com";

export const siteName = "Kosher Smart Home";

export const siteTitle = "Kosher Smart Home | בית חכם מהפלאפון הכשר";

export const siteDescription =
  "Kosher Smart Home – בית חכם מהפלאפון הכשר. שליטה במכשירי החשמל בשיחת טלפון, באתר ובתוכניות אוטומטיות, כולל תכנון מראש לשבתות ולמועדי ישראל. 058-329-6967";

export function siteUrl() {
  const configured = process.env.SITE_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || "";
  const value = /^https?:\/\//.test(configured) ? configured : DEFAULT_SITE_URL;
  return value.replace(/\/$/, "");
}
