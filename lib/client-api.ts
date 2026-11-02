export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let data: { message?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { message?: string };
    } catch {
      data = { message: "תשובה לא קריאה מהשרת" };
    }
  }
  if (response.status === 401 && !path.startsWith("/api/auth/login")) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.dispatchEvent(new Event("pikud:unauthorized"));
    }
  }
  if (!response.ok) throw new ApiError(response.status, data.message || "הבקשה נכשלה");
  return data as T;
}
