/**
 * Contratto condiviso tra reducer (lib/game.ts), store, API e UI.
 * Non modificare senza aggiornare tutti i consumer.
 */

export type Phase = "lobby" | "round" | "reveal" | "ended";

export interface Player {
  id: string; // pubblico
  token: string; // segreto: mai inviato ad altri client
  name: string;
  lastSeen: number; // ms epoch dell'ultimo polling
}

export interface RoomState {
  code: string;
  version: number; // incrementato dallo store a ogni write (lock ottimistico)
  createdAt: number;
  game: number; // contatore partite (parte da 1)
  phase: Phase;
  hostId: string;
  players: Player[]; // l'indice = seat
  round: number; // 0–7, valido in phase "round"
  roundEndsAt: number | null;
  /** sheets[i][slot] = risposta del foglietto i allo slot; null = non (ancora) risposto. Lunghezza N×8 in gioco, [] in lobby. */
  sheets: (string | null)[][];
  revealIndex: number; // foglietto attualmente rivelato (phase "reveal")
}

// ---- Azioni del reducer -------------------------------------------------
// Ogni azione porta `now` (ms epoch): il reducer non legge mai Date.now().

export type Action =
  | { type: "create"; code: string; host: { id: string; token: string; name: string }; now: number }
  | { type: "join"; player: { id: string; token: string; name: string }; now: number }
  | { type: "seen"; playerId: string; now: number } // polling: aggiorna lastSeen + settle
  | { type: "tick"; now: number } // solo settle (timeout round, host migration)
  | { type: "start"; playerId: string; now: number } // solo host, da lobby
  | { type: "answer"; playerId: string; text: string; now: number }
  | { type: "advance"; playerId: string; now: number } // solo host, in reveal: prossimo foglietto / fine
  | { type: "restart"; playerId: string; now: number }; // solo host, da reveal/ended → lobby

export type GameErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NOT_IN_LOBBY"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_HOST"
  | "NOT_A_PLAYER"
  | "NAME_TAKEN"
  | "INVALID_NAME"
  | "INVALID_ANSWER"
  | "ALREADY_ANSWERED"
  | "WRONG_PHASE"
  | "CONFLICT";

export class GameError extends Error {
  constructor(public code: GameErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GameError";
  }
}

// ---- Vista per il client (mai token, mai risposte non rivelate) ----------

export interface PlayerPublic {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  answered: boolean; // ha risposto nel round corrente
}

export interface PlayerView {
  code: string;
  version: number;
  game: number;
  phase: Phase;
  serverNow: number;
  me: { id: string; name: string; isHost: boolean; answered: boolean };
  players: PlayerPublic[];
  round: number; // 0–7
  prompt: string | null; // PROMPTS[round] in phase "round"
  roundEndsAt: number | null;
  answeredCount: number;
  total: number;
  /** In reveal: solo i foglietti già rivelati (0..index). In ended: tutti. Altrimenti null. */
  reveal: { index: number; total: number; sheets: string[][] } | null;
}

// ---- Contratto HTTP -------------------------------------------------------
// Header di autenticazione: `x-player-token: <token>`.
// Errori: status 4xx/5xx con body { error: GameErrorCode | "BAD_REQUEST" | "INTERNAL", message: string }.
//
// POST /api/room                      body {name}        → 201 { code, token, playerId }
// POST /api/room/[code]/join          body {name}        → 200 { code, token, playerId }
// GET  /api/room/[code]/state         header token       → 200 PlayerView   (aggiorna lastSeen)
// POST /api/room/[code]/answer        body {text}        → 200 PlayerView
// POST /api/room/[code]/advance                          → 200 PlayerView
// POST /api/room/[code]/start                            → 200 PlayerView
// POST /api/room/[code]/restart                          → 200 PlayerView

export interface JoinResponse {
  code: string;
  token: string;
  playerId: string;
}

export interface ApiError {
  error: string;
  message: string;
}
