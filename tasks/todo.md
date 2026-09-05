# Sigaretta — piano

## Decisioni chiave e assunzioni (10 righe)
1. Next.js 15 App Router + TypeScript, nessun Tailwind: CSS globale con custom properties (palette carta/inchiostro) per un look non-default.
2. Stato stanza = un JSON in Redis `room:{CODE}` con TTL 24h e campo `version`; scrittura via script Lua EVAL "compare-version-and-set" (Upstash REST non ha WATCH). Retry ×5 su conflitto.
3. Fallback store in-memory quando mancano le env UPSTASH_* (solo dev/test locale; in prod si usa Upstash). Nessuna altra feature extra.
4. Reducer puro `reduce(state, action) → state` in `lib/game.ts`; se nulla cambia restituisce la STESSA reference (lo store non scrive). Errori di regola = `GameError(code)` lanciato, mappato a 4xx dalle API.
5. Ogni azione applica prima `settle(now)`: chiude il round se `now ≥ roundEndsAt` (slot mancanti = null → "…"), poi host migration (host lastSeen > 30s fa → primo giocatore connesso). "Connesso" = lastSeen entro 10s.
6. Rotazione: al round r il giocatore con seat p scrive sul foglietto `(p − r) mod N`. Prompt uguale per tutti nel round (slot r). Round chiude in anticipo se tutti hanno risposto. Prima risposta vince (no sovrascrittura).
7. Identità: `Player{id pubblico, token segreto}`; il token viaggia nell'header `x-player-token`; le viste per il client (`toPlayerView`) non contengono mai token né risposte non ancora rivelate.
8. Join solo in lobby (max 10, nome 1–20 char, unico per stanza case-insensitive); rientro con token in qualsiasi fase. Restart (da reveal/ended, solo host) → torna in lobby con gli stessi giocatori.
9. Polling GET state ogni 2s in tutte le fasi; il GET aggiorna lastSeen (write solo se cambia di ≥4s per limitare i comandi Redis).
10. Codice stanza 4 lettere da `ABCDEFGHJKLMNPQRSTUVWXYZ`; l'unica cosa in localStorage è `sigaretta:{CODE}` = token.

## Task (τ = difficoltà → modello)
- [x] T0 (Fable, me): scaffold progetto, contratto tipi `lib/types.ts`, `lib/prompts.ts`
- [x] T1 (τ difficile → Fable): `lib/game.ts` reducer + `lib/game.test.ts`
- [x] T2 (τ medio → Opus): `lib/store.ts` (Upstash + memory), `lib/api.ts` helper, route handlers
- [x] T3 (τ medio → Opus): UI (home, /r/[code], componenti, CSS)
- [x] T4 (τ facile → Sonnet): README, CLAUDE.md, .env.example
- [x] T5 (me): npm test + build, smoke test API end-to-end, review

# Modalità Disegno — piano (2026-09-05)

## Decisioni e assunzioni
1. Due modalità di stanza, scelte da chi crea: `classic` (8 domande, invariata) e `drawing`.
2. Drawing: i turni si alternano — turno 1 testo libero ("descrivi una scena"), turno 2 disegno della descrizione, turno 3 descrizione del disegno, ecc. Ogni giocatore vede SOLO il passaggio precedente del foglietto che ha in mano.
3. Numero turni drawing configurabile 4–8 (default 6) alla creazione della stanza; classic resta 8. Il conteggio vive in `RoomState.slots`.
4. I disegni sono vettoriali (tratti con colore/spessore/punti quantizzati su griglia 400×400, delta-encoded) serializzati in stringa nello stesso `sheets[i][slot]`: il "tipo" dello slot deriva da `(mode, slot)`, non dal contenuto. Limite 20 000 caratteri per disegno, validato dal reducer.
5. Turni di disegno durano 90s (testo 60s). L'azione `answer` porta il `round` a cui si riferisce: se il round è già chiuso → `ROUND_OVER` (evita che una risposta in ritardo finisca nel round successivo).
6. Reveal drawing: l'host svela un passaggio alla volta (`revealStep`), poi il foglietto successivo. Il client riceve solo i passaggi già svelati.
7. Nessuna feature extra: niente riempimento a secchiello, niente salvataggio immagini.

## Task
- [x] T1 tipi/costanti: `lib/types.ts`, `lib/prompts.ts`, nuovo `lib/drawing.ts` (encode/parse/valida)
- [x] T2 reducer `lib/game.ts` + test
- [x] T3 API: create con `{mode, rounds}`, answer con `{text, round}`
- [x] T4 UI: home (scelta modalità/turni), `DrawBoard`, `DrawingView`, Round/Reveal/Ended in drawing mode, CSS
- [x] T5 docs (README, CLAUDE.md), `npm test`, `npm run build`
