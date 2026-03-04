const WebSocket                              = require('ws');
const { SECRET_ROOMS }                       = require('./config');
const { rooms, overlayFilters, roomMeta, roomHosts } = require('./state');
const { broadcast }                          = require('./utils');

// ─── JOIN ─────────────────────────────────────────────
function handleJoin(ws, clientId, msg, setRoomId) {
  const roomId = msg.room;
  const name   = msg.name || 'Anon';
  setRoomId(roomId);

  // Expired?
  if (roomMeta.has(roomId) && roomMeta.get(roomId).expiresAt <= Date.now()) {
    ws.send(JSON.stringify({ type: 'room-expired' }));
    return;
  }

  const isNew = !rooms.has(roomId);
  if (isNew) rooms.set(roomId, new Map());
  const room = rooms.get(roomId);

  // Secret room peer limit (overlay doesn't count)
  if (SECRET_ROOMS[roomId] && name !== '__overlay__') {
    const realPeers = [...room.values()].filter(c => c.name !== '__overlay__').length;
    if (realPeers >= SECRET_ROOMS[roomId].maxPeers) {
      ws.send(JSON.stringify({ type: 'room-full', max: SECRET_ROOMS[roomId].maxPeers }));
      console.log(`[${roomId}] ⛔ Room full (${realPeers}/${SECRET_ROOMS[roomId].maxPeers}), rejected: ${name}`);
      return;
    }
  }

  // Set expiry on creation, unless it's a secret room
  if (!SECRET_ROOMS[roomId] && isNew && msg.expiry) {
    const minutes = Math.min(Math.max(1, parseInt(msg.expiry) || 60), 20 * 24 * 60);
    roomMeta.set(roomId, { expiresAt: Date.now() + minutes * 60 * 1000 });
    console.log(`[${roomId}] expires in ${minutes} min (${new Date(roomMeta.get(roomId).expiresAt).toLocaleString()})`);
  }

  // Send existing peer list to newcomer
  const existing = [];
  room.forEach((client, id) => existing.push({ id, name: client.name }));
  ws.send(JSON.stringify({ type: 'peers', peers: existing }));

  broadcast(room, clientId, { type: 'peer-joined', id: clientId, name });
  room.set(clientId, { ws, name });
  console.log(`[${roomId}] +${name} (${clientId}) | celkem: ${room.size}`);

  if (roomMeta.has(roomId)) {
    ws.send(JSON.stringify({ type: 'room-info', expiresAt: roomMeta.get(roomId).expiresAt }));
  }

  // Send saved filter state to overlay
  if (name === '__overlay__' && overlayFilters.has(roomId)) {
    const saved = overlayFilters.get(roomId);
    Object.keys(saved).forEach(cam => {
      ws.send(JSON.stringify({ type: 'overlay-sync', cam: Number(cam), settings: saved[cam] }));
    });
  }
}

// ─── CLAIM-HOST ───────────────────────────────────────
function handleClaimHost(ws, clientId, msg) {
  const claimRoom = msg.room;
  if (!claimRoom) return;

  if (roomHosts.has(claimRoom)) {
    const owner = roomHosts.get(claimRoom);
    if (owner.ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'room-taken', room: claimRoom }));
      console.log(`[${claimRoom}] ⛔ host-claim zamítnuto pro ${clientId} (vlastní: ${owner.clientId})`);
      return;
    }
    roomHosts.delete(claimRoom);
  }

  roomHosts.set(claimRoom, { clientId, ws });
  ws.send(JSON.stringify({ type: 'host-claimed', room: claimRoom }));
  console.log(`[${claimRoom}] ✅ host-claim schváleno pro ${clientId}`);
}

// ─── SIGNAL ───────────────────────────────────────────
function handleSignal(ws, clientId, roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  const target = room.get(msg.to);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({ type: 'signal', from: clientId, signal: msg.signal }));
  }
}

// ─── NAME-CHANGE ──────────────────────────────────────
function handleNameChange(ws, clientId, roomId, msg) {
  const room = rooms.get(roomId);
  if (!room || !room.has(clientId)) return;
  room.get(clientId).name = msg.name;
  broadcast(room, clientId, { type: 'name-change', id: clientId, name: msg.name });
}

// ─── OVERLAY-SYNC ─────────────────────────────────────
function handleOverlaySync(ws, clientId, roomId, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (!overlayFilters.has(roomId)) overlayFilters.set(roomId, {});
  overlayFilters.get(roomId)[msg.cam] = msg.settings;
  broadcast(room, clientId, { type: 'overlay-sync', cam: msg.cam, settings: msg.settings });
}

module.exports = { handleJoin, handleClaimHost, handleSignal, handleNameChange, handleOverlaySync };
