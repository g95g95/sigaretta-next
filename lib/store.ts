import { Redis } from "@upstash/redis";
import { ROOM_TTL_S } from "./prompts";
import { GameError } from "./types";
import type { RoomState } from "./types";

export interface Store {
  get(code: string): Promise<RoomState | null>;
  /** Crea la stanza solo se il codice è libero, altrimenti GameError("CONFLICT"). */
  create(state: RoomState): Promise<void>;
  /**
   * Compare-and-set: scrive `next` (con next.version = expectedVersion + 1) solo
   * se la versione salvata è expectedVersion. Ritorna false su conflitto. Rinnova il TTL.
   */
  cas(code: string, expectedVersion: number, next: RoomState): Promise<boolean>;
}

const key = (code: string) => `room:${code}`;

/** Upstash REST non ha WATCH: la CAS è uno script Lua atomico. */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local v = cjson.decode(cur).version
if v ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

class UpstashStore implements Store {
  // automaticDeserialization off: i valori restano stringhe JSON, come le vede lo script Lua.
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token, automaticDeserialization: false });
  }

  async get(code: string): Promise<RoomState | null> {
    const raw = await this.redis.get<string>(key(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async create(state: RoomState): Promise<void> {
    const ok = await this.redis.set(key(state.code), JSON.stringify(state), {
      nx: true,
      ex: ROOM_TTL_S,
    });
    if (!ok) throw new GameError("CONFLICT");
  }

  async cas(code: string, expectedVersion: number, next: RoomState): Promise<boolean> {
    const res = await this.redis.eval(
      CAS_SCRIPT,
      [key(code)],
      [String(expectedVersion), JSON.stringify(next), String(ROOM_TTL_S)],
    );
    return Number(res) === 1;
  }
}

/** Fallback per lo sviluppo locale: nessun TTL, nessuna condivisione tra processi. */
class MemoryStore implements Store {
  private rooms = new Map<string, string>();

  async get(code: string): Promise<RoomState | null> {
    const raw = this.rooms.get(key(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async create(state: RoomState): Promise<void> {
    const k = key(state.code);
    if (this.rooms.has(k)) throw new GameError("CONFLICT");
    this.rooms.set(k, JSON.stringify(state));
  }

  async cas(code: string, expectedVersion: number, next: RoomState): Promise<boolean> {
    const k = key(code);
    const raw = this.rooms.get(k);
    if (!raw) return false;
    if ((JSON.parse(raw) as RoomState).version !== expectedVersion) return false;
    this.rooms.set(k, JSON.stringify(next));
    return true;
  }
}

// Il singleton vive su globalThis per sopravvivere all'HMR di `next dev`.
const globalStore = globalThis as typeof globalThis & { __sigarettaStore?: Store };

export function getStore(): Store {
  if (globalStore.__sigarettaStore) return globalStore.__sigarettaStore;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    globalStore.__sigarettaStore = new UpstashStore(url, token);
  } else {
    console.warn("[sigaretta] UPSTASH_REDIS_REST_* mancanti: store in memoria (solo dev).");
    globalStore.__sigarettaStore = new MemoryStore();
  }
  return globalStore.__sigarettaStore;
}
