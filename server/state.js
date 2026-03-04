// ─── IN-MEMORY STATE ─────────────────────────────────
const rooms         = new Map(); // roomId -> Map(clientId -> { ws, name })
const overlayFilters = new Map(); // roomId -> { camN: { br,co,sa,hu,mir } }
const roomMeta      = new Map(); // roomId -> { expiresAt: timestamp }
const roomHosts     = new Map(); // roomId -> { clientId, ws }

module.exports = { rooms, overlayFilters, roomMeta, roomHosts };
