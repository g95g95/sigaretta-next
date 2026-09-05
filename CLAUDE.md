# Sigaretta

Gioco dei bigliettini online (vedi README.md per la descrizione funzionale).

## Stack

Next.js 15 (App Router), React 19, TypeScript strict, `@upstash/redis` (REST), vitest, CSS globale senza Tailwind.

## Comandi

- `npm run dev` — sviluppo
- `npm test` — test vitest
- `npm run build` — build di produzione
- `npm run typecheck` — controllo tipi

## Struttura

- `lib/types.ts` — contratto condiviso (tipi, azioni, contratto HTTP): non modificare senza aggiornare tutti i consumer.
- `lib/prompts.ts` — costanti di gioco, default/limiti delle impostazioni di stanza (incluso `MAX_ROOM_NAME_LEN`), gli 8 prompt fissi e gli helper per modalità/slot (`slotKind`, `promptFor`, `roundDuration`).
- `lib/drawing.ts` — formato dei disegni (tratti vettoriali su griglia 400x400, delta-encoded), `serializeDrawing`/`parseDrawing`.
- `lib/game.ts` — reducer puro delle regole di gioco, con `lib/game.test.ts`.
- `lib/store.ts` — store della stanza (Redis o memoria) con scrittura CAS (compare-and-swap).
- `lib/api.ts` — helper condivisi dalle route handler.
- `app/api/room/**` — route handler HTTP.
- `app/page.tsx` — home.
- `app/r/[code]` — pagina stanza.
- `components/` — UI (`DrawBoard` = lavagna canvas, `DrawingView` = rendering SVG di un disegno).
- `lib/client.ts` — helper fetch lato client + gestione token.

## Modalità di gioco

- `settings.mode`: `classic` (8 domande fisse) o `drawing` (turni `settings.rounds` 4–8). Scelta alla creazione (home) e modificabile dall'host in lobby insieme alle altre impostazioni. In drawing gli slot pari (0, 2, …) sono testo, i dispari disegno (`slotKind`); in round il giocatore vede solo il passaggio precedente del foglietto in mano (`PlayerView.previous`).
- Il tipo di uno slot deriva sempre da `(mode, slot)`, mai dal contenuto: i disegni sono stringhe serializzate nello stesso `sheets[i][slot]`, validate dal reducer con `parseDrawing`.
- I turni di disegno durano `roundMs + DRAW_EXTRA_MS`; il client li autoinvia a 3s dalla fine.
- L'azione `answer` porta il `round` a cui si riferisce: se non coincide → `ROUND_OVER` (una risposta in ritardo non finisce mai nel round successivo).
- Reveal in drawing: `revealStep` avanza un passaggio alla volta; il client riceve solo i passaggi già svelati.

## Convenzioni

- Il reducer in `lib/game.ts` è puro: nessun I/O, riceve sempre `now` dentro l'azione (mai `Date.now()` al suo interno).
- Nessuna mutazione dello stato in input; se nulla cambia il reducer ritorna la stessa reference (lo store non scrive).
- Ogni mutazione via API segue lo schema get → reduce → CAS con retry su conflitto di versione.
- Il client non riceve mai token di altri giocatori né risposte non ancora rivelate.
- UI in italiano, mobile-first.
- La UI legge lo stato solo via polling `GET state` ogni 2s (5s in `ended`, dove la vista contiene tutti i disegni), sospeso quando il tab è nascosto; ogni POST adotta subito la `PlayerView` restituita.
- Il countdown fissa l'offset `serverNow − Date.now()` una volta per view: ricalcolarlo a ogni polling farebbe saltellare il timer.
- Le impostazioni di stanza (nome stanza, modalità, turni, min/max giocatori, tempo per round, caratteri per risposta) vivono in `RoomState.settings`: leggerle sempre con `settingsOf(state)`, che completa con i default le stanze salvate prima (anche per singolo campo).
- Nessun uso di localStorage oltre al token della stanza.
- Nessuna feature extra fuori scope (account, chat, salvataggio partite).

Prima di dichiarare un task finito: `npm test` e `npm run build` devono essere verdi.
