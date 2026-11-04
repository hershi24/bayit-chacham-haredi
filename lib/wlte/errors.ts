const TOKEN_REJECTION_CODES = new Set(["AUTH_INVALID", "AUTH_EXPIRED", "AUTH_REQUIRED", "AUTH_SCOPE_DENIED"]);

export function isTokenRejection(status?: number, code?: string): boolean {
  if (code && TOKEN_REJECTION_CODES.has(code)) return true;
  return status === 401 || status === 403;
}

const MESSAGES: Record<string, string> = {
  AUTH_INVALID: "פרטי ה-API אינם תקינים",
  AUTH_EXPIRED: "פג תוקף האסימון",
  AUTH_REQUIRED: "נדרש אסימון גישה",
  AUTH_SCOPE_DENIED: "לאסימון חסרות הרשאות מול WLTE",
  APP_DISABLED: "לקוח ה-API מושבת",
  DEVICE_NOT_FOUND: "השקע לא נמצא ב-WLTE",
  DEVICE_OFFLINE: "השקע אינו מחובר",
  DEVICE_BUSY: "השקע עסוק בפקודה אחרת",
  IDEMPOTENCY_CONFLICT: "מפתח הפקודה כבר שימש לבקשה אחרת",
  RATE_LIMITED: "יותר מדי בקשות. נסו שוב בעוד רגע",
  COMMAND_REJECTED: "הפקודה נדחתה",
  TIMEOUT: "לא התקבל אישור מהשקע",
  GATEWAY_UNAVAILABLE: "שער WLTE אינו זמין",
  INVALID_REQUEST: "הבקשה ל-WLTE אינה תקינה",
  INTERNAL_ERROR: "WLTE החזיר שגיאה פנימית",
  RETRY_EXHAUSTED: "הפקודה לא הושלמה אחרי ניסיונות חוזרים",
};

export function wlteMessage(code: string | undefined, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  return fallback || "הפעולה מול WLTE נכשלה";
}

export class WlteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(wlteMessage(code, message));
    this.name = "WlteError";
    this.code = code;
    this.status = status;
  }
}

export function isWlteError(error: unknown): error is WlteError {
  if (!(error instanceof Error)) return false;
  if (error instanceof WlteError) return true;
  const candidate = error as Partial<WlteError>;
  return error.name === "WlteError" && typeof candidate.code === "string" && typeof candidate.status === "number";
}
