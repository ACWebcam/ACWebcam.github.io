const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

const { setupWebSocket }                   = require('./server/ws');
const { rooms, overlayFilters, roomMeta }  = require('./server/state');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── NO-CACHE HEADERS ────────────────────────────────
app.use((req, res, next) => {
  if (/\.(js|html)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── WEBSOCKET ───────────────────────────────────────
setupWebSocket(wss);

// ─── PERIODIC EXPIRY CHECK ───────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [roomId, meta] of roomMeta) {
    if (meta.expiresAt <= now && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.forEach((client) => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'room-expired' }));
          client.ws.close();
        }
      });
      rooms.delete(roomId);
      overlayFilters.delete(roomId);
      roomMeta.delete(roomId);
      console.log(`[${roomId}] expired & cleaned up`);
    }
  }
}, 30000);

// ─── START ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  WebRTC Studio běží na http://localhost:${PORT}\n`);
});


