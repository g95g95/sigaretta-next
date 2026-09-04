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
- `lib/prompts.ts` — costanti di gioco e gli 8 prompt fissi.
- `lib/game.ts` — reducer puro delle regole di gioco, con `lib/game.test.ts`.
- `lib/store.ts` — store della stanza (Redis o memoria) con scrittura CAS (compare-and-swap).
- `lib/api.ts` — helper condivisi dalle route handler.
- `app/api/room/**` — route handler HTTP.
- `app/page.tsx` — home.
- `app/r/[code]` — pagina stanza.
- `components/` — UI.
- `lib/client.ts` — helper fetch lato client + gestione token.

## Convenzioni

- Il reducer in `lib/game.ts` è puro: nessun I/O, riceve sempre `now` dentro l'azione (mai `Date.now()` al suo interno).
- Nessuna mutazione dello stato in input; se nulla cambia il reducer ritorna la stessa reference (lo store non scrive).
- Ogni mutazione via API segue lo schema get → reduce → CAS con retry su conflitto di versione.
- Il client non riceve mai token di altri giocatori né risposte non ancora rivelate.
- UI in italiano, mobile-first.
- La UI legge lo stato solo via polling `GET state` ogni 2s, sospeso quando il tab è nascosto; ogni POST adotta subito la `PlayerView` restituita.
- Il countdown fissa l'offset `serverNow − Date.now()` una volta per view: ricalcolarlo a ogni polling farebbe saltellare il timer.
- Nessun uso di localStorage oltre al token della stanza.
- Nessuna feature extra fuori scope (account, chat, salvataggio partite).

Prima di dichiarare un task finito: `npm test` e `npm run build` devono essere verdi.
