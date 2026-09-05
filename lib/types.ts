/**
 * Contratto condiviso tra reducer (lib/game.ts), store, API e UI.
 * Non modificare senza aggiornare tutti i consumer.
 */

export type Phase = "lobby" | "round" | "reveal" | "ended";

/** classic = 8 domande fisse; drawing = descrivi → disegna → descrivi… (turni configurabili). */
export type GameMode = "classic" | "drawing";
/** Cosa si inserisce in uno slot: derivato da (mode, slot), mai dal contenuto. */
export type SlotKind = "text" | "drawing";

export interface Player {
  id: string; // pubblico
  token: string; // segreto: mai inviato ad altri client
  name: string;
  lastSeen: number; // ms epoch dell'ultimo polling
}

/** Impostazioni della stanza: scelte alla creazione, modificabili dall'host in lobby. */
export interface RoomSettings {
  mode: GameMode;
  rounds: number; // turni/slot per foglietto: 8 in classic, 4–8 in drawing
  minPlayers: number; // giocatori minimi per avviare la partita
  maxPlayers: number; // capienza della stanza
  roundMs: number; // tempo massimo di attesa per un round di testo, in ms (disegno: +DRAW_EXTRA_MS)
  maxAnswerLen: number; // caratteri massimi per risposta
}

/** Aggiornamento parziale: i campi omessi restano invariati. */
export type SettingsPatch = Partial<RoomSettings>;

export interface RoomState {
  code: string;
  version: number; // incrementato dallo store a ogni write (lock ottimistico)
  createdAt: number;
  game: number; // contatore partite (parte da 1)
  phase: Phase;
  hostId: string;
  settings: RoomSettings;
  players: Player[]; // l'indice = seat
  round: number; // 0–rounds-1, valido in phase "round"
  roundEndsAt: number | null;
  /**
   * sheets[i][slot] = risposta del foglietto i allo slot; null = non (ancora) risposto.
   * Lunghezza N×rounds in gioco, [] in lobby. Negli slot di tipo "drawing" la stringa è
   * un disegno serializzato (vedi lib/drawing.ts).
   */
  sheets: (string | null)[][];
  revealIndex: number; // foglietto attualmente rivelato (phase "reveal")
  revealStep: number; // passaggi svelati del foglietto corrente (solo drawing: 0–rounds-1)
}

// ---- Azioni del reducer -------------------------------------------------
// Ogni azione porta `now` (ms epoch): il reducer non legge mai Date.now().

export type Action =
  | {
      type: "create";
      code: string;
      host: { id: string; token: string; name: string };
      settings: SettingsPatch; // applicato sui default
      now: number;
    }
  | { type: "join"; player: { id: string; token: string; name: string }; now: number }
  | { type: "seen"; playerId: string; now: number } // polling: aggiorna lastSeen + settle
  | { type: "tick"; now: number } // solo settle (timeout round, host migration)
  | { type: "start"; playerId: string; now: number } // solo host, da lobby
  | { type: "settings"; playerId: string; patch: SettingsPatch; now: number } // solo host, in lobby
  | { type: "answer"; playerId: string; round: number; text: string; now: number } // round = quello a cui risponde
  | { type: "advance"; playerId: string; now: number } // solo host, in reveal: prossimo passaggio/foglietto / fine
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
  | "INVALID_SETTINGS"
  | "ALREADY_ANSWERED"
  | "ROUND_OVER"
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
  settings: RoomSettings;
  mode: GameMode; // = settings.mode
  slots: number; // = settings.rounds
  me: { id: string; name: string; isHost: boolean; answered: boolean };
  players: PlayerPublic[];
  round: number; // 0–slots-1
  prompt: string | null; // consegna in phase "round"
  kind: SlotKind | null; // cosa inserire in phase "round"
  /** Drawing, round ≥ 1: il passaggio precedente del foglietto in mano (null se saltato o non applicabile). */
  previous: string | null;
  roundEndsAt: number | null;
  answeredCount: number;
  total: number;
  /**
   * In reveal: solo i foglietti già rivelati (0..index); in drawing l'ultimo è troncato ai
   * passaggi svelati (0..step). In ended: tutti, completi. Altrimenti null.
   */
  reveal: { index: number; step: number; total: number; sheets: string[][] } | null;
}

// ---- Contratto HTTP -------------------------------------------------------
// Header di autenticazione: `x-player-token: <token>`.
// Errori: status 4xx/5xx con body { error: GameErrorCode | "BAD_REQUEST" | "INTERNAL", message: string }.
//
// POST /api/room                      body {name, mode?, rounds?} → 201 { code, token, playerId }
// POST /api/room/[code]/join          body {name}        → 200 { code, token, playerId }
// GET  /api/room/[code]/state         header token       → 200 PlayerView   (aggiorna lastSeen)
// POST /api/room/[code]/answer        body {text, round} → 200 PlayerView
// POST /api/room/[code]/advance                          → 200 PlayerView
// POST /api/room/[code]/start                            → 200 PlayerView
// POST /api/room/[code]/settings      body SettingsPatch → 200 PlayerView   (solo host, in lobby)
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
