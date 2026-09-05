/** Helper client-side: token in localStorage + wrapper fetch sulle API. */

import type { ApiError } from "@/lib/types";

const key = (code: string) => `sigaretta:${code}`;

export function getToken(code: string): string | null {
  try {
    return localStorage.getItem(key(code));
  } catch {
    return null;
  }
}

export function setToken(code: string, token: string): void {
  try {
    localStorage.setItem(key(code), token);
  } catch {
    /* storage non disponibile (private mode): si gioca comunque finché la tab resta aperta */
  }
}

export function clearToken(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    /* idem */
  }
}

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = opts;
  const headers: Record<string, string> = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    let payload: Partial<ApiError> = {};
    try {
      payload = (await res.json()) as Partial<ApiError>;
    } catch {
      /* body non JSON: restiamo sui default */
    }
    throw new ApiClientError(payload.error ?? "INTERNAL", payload.message ?? res.statusText);
  }

  return (await res.json()) as T;
}

const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: "Stanza non trovata",
  ROOM_FULL: "Stanza piena",
  NOT_IN_LOBBY: "La partita è già iniziata",
  NOT_ENOUGH_PLAYERS: "Non ci sono abbastanza giocatori",
  NOT_HOST: "Solo l'host può farlo",
  NOT_A_PLAYER: "Non sei in questa stanza",
  NAME_TAKEN: "Nome già in uso",
  INVALID_NAME: "Nome non valido",
  INVALID_ANSWER: "Risposta non valida",
  INVALID_SETTINGS: "Impostazioni non valide",
  ROUND_OVER: "Tempo scaduto per questo turno",
  WRONG_PHASE: "Azione non disponibile ora",
  CONFLICT: "Riprova tra un istante",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    // INVALID_SETTINGS: il server spiega quale limite è stato violato.
    if (err.code === "INVALID_SETTINGS") return err.message || "Impostazioni non valide";
    return MESSAGES[err.code] ?? "Qualcosa è andato storto";
  }
  return "Qualcosa è andato storto";
}
