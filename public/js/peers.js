import { ROOM_ID, MY_NAME, ROOM_LIMITS } from './config.js';
import { state, peers, peerNames } from './state.js';
import { showToast } from './utils.js';
import { setPeerName, setRemoteStream, removePeer, updatePeerCount } from './tiles.js';
import { startExpiryCountdown } from './expiry.js';

// ─── LISTENERS ───────────────────────────────────────
export function setupPeerListeners() {
  state.myPeer.on('connection', (conn) => setupDataConn(conn, false));
  state.myPeer.on('call', (call) => {
    call.answer(state.localStream || new MediaStream());
    setupMediaConn(call);
  });
}

// ─── CONNECT TO PEER ─────────────────────────────────
export function connectToPeer(peerId, name) {
  if (peers.has(peerId) || peerId === state.myId) return;
  const dataConn = state.myPeer.connect(peerId, { reliable: true, metadata: { name: MY_NAME } });
  setupDataConn(dataConn, true);
  if (state.localStream?.getTracks().length > 0) {
    const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
    if (call) setupMediaConn(call);
  }
}

// ─── OVERLAYS ────────────────────────────────────────
export function sendStreamToOverlays() {
  if (!state.localStream?.getTracks().length) return;
  peers.forEach((entry, peerId) => {
    if (entry.isOverlay && !entry.mediaConn) {
      console.log('[room] Sending stream to overlay:', peerId);
      const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
      if (call) setupMediaConn(call);
    }
  });
}

// Called when host role is confirmed (WS or fallback).
// Re-sends the full peer list to any overlays that connected
// before isHost was true and therefore got an empty list.
export function syncPeersToOverlays() {
  peers.forEach((overlayEntry, overlayId) => {
    if (!overlayEntry.isOverlay || !overlayEntry.dataConn?.open) return;
    const peerList = [];
    peers.forEach((e, id) => {
      if (id !== overlayId && !e.isOverlay)
        peerList.push({ id, name: peerNames.get(id) || id });
    });
    console.log('[room] syncPeersToOverlays → sending', peerList.length, 'peers to overlay', overlayId);
    overlayEntry.dataConn.send({ type: 'peers', peers: peerList });
  });
}

// ─── DATA CONNECTION ─────────────────────────────────
export function setupDataConn(conn, isInitiator) {
  const peerId = conn.peer;

  conn.on('open', () => {
    const entry    = peers.get(peerId) || {};
    entry.dataConn  = conn;
    entry.isOverlay = false;
    peers.set(peerId, entry);

    const peerName = conn.metadata?.name || peerNames.get(peerId) || peerId;
    setPeerName(peerId, peerName);

    if (peerName === '__overlay__') {
      console.log('[room] Overlay detected:', peerId);
      entry.isOverlay = true;
      if (state.localStream?.getTracks().length > 0 && !entry.mediaConn) {
        console.log('[room] Calling overlay with media now');
        const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
        if (call) setupMediaConn(call);
      }
    }

    if (state.isHost) {
      // Check room peer limit
      const limit = ROOM_LIMITS[ROOM_ID];
      if (limit && peerName !== '__overlay__') {
        const realCount = [...peers.values()].filter(e => !e.isOverlay).length;
        // +1 for host (host is not in peers map)
        if (realCount + 1 > limit.maxPeers) {
          console.log('[room] ⛔ Room full, kicking:', peerId);
          conn.send({ type: 'room-full', max: limit.maxPeers });
          setTimeout(() => { try { conn.close(); } catch {} removePeer(peerId); }, 300);
          return;
        }
      }

      // Send existing peer list
      const peerList = [];
      peers.forEach((e, id) => {
        if (id !== peerId && id !== state.myId) peerList.push({ id, name: peerNames.get(id) || id });
      });
      conn.send({ type: 'peers', peers: peerList });

      // Room expiry
      const stored = localStorage.getItem('room-expiry-' + ROOM_ID);
      if (stored) conn.send({ type: 'room-info', expiresAt: parseInt(stored) });

      broadcastData({ type: 'peer-joined', id: peerId, name: peerName }, peerId);
    }

    updatePeerCount();
  });

  conn.on('data',  (data) => handleData(peerId, data));
  conn.on('close', ()     => handlePeerDisconnect(peerId));
  conn.on('error', ()     => {});
}

// ─── MEDIA CONNECTION ────────────────────────────────
export function setupMediaConn(call) {
  const peerId = call.peer;

  call.on('stream', (remoteStream) => {
    const name = call.metadata?.name || peerNames.get(peerId) || peerId;
    setPeerName(peerId, name);
    setRemoteStream(peerId, remoteStream);
  });

  call.on('iceStateChanged', (iceState) => {
    console.log('[ICE] peerId:', peerId, '| state:', iceState);

    if (iceState === 'disconnected') {
      // 'disconnected' can be transient — wait 4s before forcing a full re-call.
      // NOTE: pc.restartIce() is a no-op with PeerJS (PeerJS doesn't intercept
      // renegotiation signals from the underlying RTCPeerConnection), so we go
      // straight to reconnectMedia() which creates a fresh PeerJS call.
      console.log('[ICE] Disconnected, will reconnect in 4s if unresolved for', peerId);
      setTimeout(() => {
        const entry = peers.get(peerId);
        if (entry?.mediaConn !== call) return; // already replaced by a newer call
        const pc = call.peerConnection;
        if (pc && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
          console.log('[ICE] Still disconnected after 4s, forcing reconnect for', peerId);
          reconnectMedia(peerId);
        }
      }, 4000);
    } else if (iceState === 'failed') {
      showToast('⚠️ ICE failed – zkouším znovu spojení...');
      console.warn('[ICE] Failed for', peerId, '– renegotiating');
      setTimeout(() => {
        if (peers.get(peerId)?.mediaConn === call) reconnectMedia(peerId);
      }, 1000);
    } else if (iceState === 'connected' || iceState === 'completed') {
      console.log('[ICE] ✅ Connected to', peerId);
    }
  });

  // Guard: only propagate close if this is still the active call for this peer
  call.on('close', () => {
    if (peers.get(peerId)?.mediaConn === call) handlePeerDisconnect(peerId);
    else console.log('[room] Ignoring close of stale/duplicate call for', peerId);
  });
  call.on('error', () => {});

  const entry = peers.get(peerId) || {};
  entry.mediaConn = call;
  peers.set(peerId, entry);
}

// ─── ICE RECONNECT ───────────────────────────────────
export function reconnectMedia(peerId) {
  if (!state.localStream?.getTracks().length) return;
  const entry = peers.get(peerId);
  if (!entry) return;
  if (entry.mediaConn) { try { entry.mediaConn.close(); } catch {} entry.mediaConn = null; }
  // Overlays never initiate calls — always re-call them unconditionally.
  // For room-to-room peers, only the lexicographically larger ID initiates
  // to prevent both sides from calling each other simultaneously.
  const isOverlay = entry.isOverlay;
  if (isOverlay || state.myId > peerId) {
    console.log('[room] Reconnecting media to', isOverlay ? 'overlay' : 'peer', peerId);
    const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
    if (call) setupMediaConn(call);
  }
}

// ─── DATA HANDLING ───────────────────────────────────
export function handleData(fromId, data) {
  if (!data?.type) return;
  switch (data.type) {
    case 'peers':
      for (const p of data.peers) {
        if (!peers.has(p.id) && p.id !== state.myId) { setPeerName(p.id, p.name); connectToPeer(p.id, p.name); }
      }
      break;
    case 'peer-joined':
      setPeerName(data.id, data.name);
      break;
    case 'peer-left':
      removePeer(data.id);
      break;
    case 'name-change':
      setPeerName(data.id, data.name);
      break;
    case 'overlay-sync':
      state.overlayBC?.postMessage({ cam: data.cam, settings: data.settings });
      break;
    case 'room-info':
      startExpiryCountdown(data.expiresAt);
      break;
    case 'room-expired':
      alert('⏰ Platnost místnosti vypršela.');
      window.location.href = 'index.html';
      break;
    case 'room-full':
      alert(`⛔ Místnost je plná (max ${data.max} účastníků).`);
      window.location.href = 'index.html';
      break;
  }
}

// ─── DISCONNECT ──────────────────────────────────────
export function handlePeerDisconnect(peerId) {
  removePeer(peerId);
  if (state.isHost) broadcastData({ type: 'peer-left', id: peerId }, peerId);
}

export function broadcastData(msg, excludeId) {
  peers.forEach((entry, id) => {
    if (id !== excludeId && entry.dataConn?.open) {
      try { entry.dataConn.send(msg); } catch {}
    }
  });
}
