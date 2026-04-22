# 🛡️ WarEra MoD Dashboard

Dashboard per il Ministro della Difesa di WarEra.io — gestione battaglioni e analisi MU.

## Setup iniziale (una sola volta)

### 1. Clona il repo in locale
```bash
git clone https://github.com/francescoparadiso/WarEraMoDDashboard.git
cd WarEraMoDDashboard
npm install
```

### 2. Avvia in locale per testare
```bash
npm run dev
```
Apri http://localhost:5173 nel browser.

### 3. Configura GitHub Pages
Nel tuo repo su GitHub:
- Vai su **Settings → Pages**
- In "Source" seleziona **"Deploy from a branch"**
- Branch: **`gh-pages`**, cartella: **`/ (root)`**
- Salva

### 4. Abilita le Actions
Vai su **Settings → Actions → General** e assicurati che i workflow abbiano il permesso di scrivere nel repo (spunta "Read and write permissions").

### 5. Fai il primo push
```bash
git add .
git commit -m "Migrazione a Vite"
git push origin main
```

GitHub Actions farà automaticamente il build e lo deploy su gh-pages.
Il sito sarà disponibile su: `https://francescoparadiso.github.io/WarEraMoDDashboard/`

---

## Workflow quotidiano

Modifica i file, poi:
```bash
git add .
git commit -m "descrizione modifica"
git push origin main
```
Il sito si aggiorna automaticamente in ~1 minuto.

---

## Struttura file

```
├── src/
│   └── main.js          ← tutto il JavaScript
├── index.html           ← HTML + CSS
├── Mu.csv               ← lista ID delle MU
├── package.json
├── vite.config.js       ← ricordati di mettere il nome corretto del repo!
└── .github/
    └── workflows/
        └── deploy.yml   ← deploy automatico su Pages
```

## ⚠️ Nota importante su vite.config.js

Assicurati che `base` corrisponda al nome ESATTO del tuo repository:

```js
export default {
  base: '/WarEraMoDDashboard/', // deve essere identico al nome del repo
}
```
