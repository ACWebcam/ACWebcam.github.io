# WebRTC Studio + Academy Clash Overlay

Živé video přes prohlížeč s nízkou latencí, bez instalace, **bez vlastního serveru**.

## Funkce

- **WebRTC místnosti** – vytvoř roomku, sdílej link, vysílej kameru/mikrofon/obrazovku
- **Academy Clash overlay** – esport broadcast overlay s 2 kamerami (1920×1080)
- **OBS integrace** – `?obs=1` link pro čistý výstup bez UI
- **Sync filtrů** – úprava jasu/kontrastu/saturace/odstínu z vieweru se přenáší do OBS
- **Expirace roomek** – nastavitelná doba platnosti (max 20 dní)

## Architektura

Projekt funguje **čistě staticky** (GitHub Pages, Netlify, apod.):

- **PeerJS Cloud** – signaling server (zdarma, žádná konfigurace)
- **BroadcastChannel API** – sync filtrů mezi taby ve stejném prohlížeči
- **PeerJS DataConnection** – přenos dat mezi peery (peer list, overlay-sync, jména)
- **localStorage** – expirace roomek (client-side)

Žádný vlastní server není potřeba.

## Nasazení na GitHub Pages

1. Pushni repo na GitHub
2. Jdi do **Settings → Pages**
3. Source: **GitHub Actions**
4. Workflow `deploy.yml` automaticky nasadí složku `public/`

Nebo ručně: Settings → Pages → Source: Deploy from branch → `main` branch → `/docs` folder (v tom případě přejmenuj `public/` na `docs/`)

## Lokální vývoj

```bash
# Stačí jakýkoli statický server, např:
npx serve public
# nebo
cd public && python -m http.server 3000
```

## Struktura

```
├── .github/workflows/deploy.yml  # GitHub Pages deploy
├── public/
│   ├── index.html         # Landing page
│   ├── room.html          # Room UI – video grid, ovládání
│   ├── room.js            # WebRTC engine (PeerJS)
│   ├── style.css          # Styling
│   ├── overlay.html       # Academy Clash overlay
│   ├── overlay.css        # Overlay styly
│   ├── overlay-viewer.js  # Overlay logika (PeerJS viewer, filtry)
│   └── navico.png         # Logo
├── server.js              # (volitelně) lokální Express server
└── package.json
```
