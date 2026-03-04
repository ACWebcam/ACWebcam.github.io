const { generateId, broadcast }                          = require('./utils');
const { rooms, overlayFilters, roomMeta, roomHosts }     = require('./state');
const { handleJoin, handleClaimHost, handleSignal,
        handleNameChange, handleOverlaySync }            = require('./handlers');

function setupWebSocket(wss) {
  wss.on('connection', (ws) => {
    const clientId = generateId();
    let roomId = null;

    ws.send(JSON.stringify({ type: 'id', id: clientId }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'join':
          handleJoin(ws, clientId, msg, (id) => { roomId = id; });
          break;
        case 'claim-host':
          handleClaimHost(ws, clientId, msg);
          break;
        case 'signal':
          handleSignal(ws, clientId, roomId, msg);
          break;
        case 'name-change':
          handleNameChange(ws, clientId, roomId, msg);
          break;
        case 'overlay-sync':
          handleOverlaySync(ws, clientId, roomId, msg);
          break;
      }
    });

    ws.on('close', () => {
      // Release host-claim if this was the host
      roomHosts.forEach((owner, rid) => {
        if (owner.clientId === clientId) {
          roomHosts.delete(rid);
          console.log(`[${rid}] host-claim uvolněno (${clientId} odpojen)`);
        }
      });

      if (!roomId || !rooms.has(roomId)) return;
      const room = rooms.get(roomId);
      room.delete(clientId);
      broadcast(room, clientId, { type: 'peer-left', id: clientId });
      if (room.size === 0) {
        rooms.delete(roomId);
        overlayFilters.delete(roomId);
        roomMeta.delete(roomId);
      }
      console.log(`[${roomId}] -${clientId} | zbývá: ${room.size}`);
    });

    ws.on('error', (err) => console.error('WS chyba:', err.message));
  });
}

module.exports = { setupWebSocket };
