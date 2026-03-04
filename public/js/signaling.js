import { ROOM_ID, ICE_CONFIG, getHostId } from './config.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { setupPeerListeners, connectToPeer } from './peers.js';

// ─── WEBSOCKET HOST-CLAIM ─────────────────────────────
let sigWS      = null;
let sigWSReady = false;
const sigQueue = [];

export function connectSignalingServer() {
  const wsUrl = location.origin.replace(/^https?/, p => p === 'https' ? 'wss' : 'ws');
  sigWS = new WebSocket(wsUrl);

  sigWS.addEventListener('open', () => {
    sigWSReady = true;
    while (sigQueue.length) sigWS.send(sigQueue.shift());
  });

  sigWS.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'host-claimed') {
      console.log('[room] ✅ Host claim potvrzen pro:', msg.room);
      state.isHost = true;
      showToast('✅ Místnost vytvořena');
      setupPeerListeners();
    }
    if (msg.type === 'room-taken') {
      console.warn('[room] ⛔ Room code obsazen jiným hostem, připojuji jako peer...');
      showToast('⏳ Připojování k existující místnosti...');
      if (state.myPeer && !state.myPeer.destroyed) state.myPeer.destroy();
      joinAsRegularPeer();
    }
  });

  sigWS.addEventListener('error', () => {});
}

export function sigSend(msg) {
  const str = JSON.stringify(msg);
  if (sigWSReady && sigWS?.readyState === WebSocket.OPEN) sigWS.send(str);
  else sigQueue.push(str);
}

// ─── PEERJS BOOTSTRAP ────────────────────────────────
export function connectPeerJS() {
  const hostId = getHostId();
  state.myPeer = new Peer(hostId, { debug: 0, config: ICE_CONFIG });

  state.myPeer.on('open', (id) => {
    state.myId = id;
    console.log('[room] PeerJS host ID acquired:', id, '| claiming on server...');
    sigSend({ type: 'claim-host', room: ROOM_ID });
    // isHost + setupPeerListeners() are triggered by 'host-claimed' WS message
  });

  state.myPeer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // PeerJS host ID already taken — join as regular peer
      state.myPeer.destroy();
      joinAsRegularPeer();
    } else {
      handlePeerError(err);
    }
  });
}

export function joinAsRegularPeer() {
  const hostId = getHostId();
  state.myPeer = new Peer(undefined, { debug: 0, config: ICE_CONFIG });

  state.myPeer.on('open', (id) => {
    state.myId   = id;
    state.isHost = false;
    console.log('✅ Joined as peer:', id);
    setupPeerListeners();
    connectToPeer(hostId, 'Host');
  });

  state.myPeer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      // Host not found yet — retry full reconnect in 3s
      console.warn('[room] Host not found, retrying in 3s...');
      showToast('⏳ Připojování k místnosti...');
      setTimeout(() => {
        if (state.myPeer && !state.myPeer.destroyed) state.myPeer.destroy();
        connectPeerJS();
      }, 3000);
    } else {
      handlePeerError(err);
    }
  });
}

function handlePeerError(err) {
  console.error('PeerJS error:', err.type, err.message);
  if (err.type === 'peer-unavailable') {
    showToast('⚠️ Místnost neexistuje nebo host odešel');
  } else if (err.type === 'disconnected' || err.type === 'network') {
    showToast('⚠️ Spojení ztraceno, obnovuji...');
    setTimeout(() => { if (state.myPeer && !state.myPeer.destroyed) state.myPeer.reconnect(); }, 2000);
  }
}
