# Istruzioni di lavoro

- Eseguire direttamente gli slash command espliciti seguendo il loro workflow.
- Commentare solo il codice complesso; modifiche minime, correggere le cause.
- Prima piano in `tasks/todo.md`, poi approvazione dell'utente, poi codice.
- Eseguire test di regressione prima di dichiarare completato il lavoro.
- Mantenere questo file aggiornato quando cambiano feature o regole.
- Dichiarare le incertezze su prodotti, API e UI; verificare le fonti senza inventare.
- Convenzioni e architettura del gioco: vedere `CLAUDE.md`.

## PWA

- Manifest nativo in `app/manifest.ts`, identita e avvio `/`, display standalone.
- Icone in `public/icons/`; sorgente generata e prompt in `assets/`.
- `InstallApp` nella home gestisce il prompt disponibile e le istruzioni iOS.
- `PwaRegistration` registra `/sw.js` solo nelle build di produzione.
- Il service worker salva esclusivamente `/offline.html`. API, token, pagine
  delle stanze e payload RSC non devono essere memorizzati in cache.
- Le partite richiedono rete: nessun invio differito delle risposte.
- Gli aggiornamenti del worker attendono la chiusura delle pagine precedenti:
  evitare ricaricamenti forzati durante una partita.
- Verifiche: `npm test`, `npm run build`, `npm run typecheck`, browser sulla
  build di produzione. L'installazione su telefono fisico va verificata a parte.
