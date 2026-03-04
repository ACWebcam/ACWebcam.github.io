import { ROOM_ID, MY_NAME, ROOM_LIMITS } from './config.js';
import { state, peers, peerNames } from './state.js';
import { showToast } from './utils.js';
import { setPeerName, setRemoteStream, removePeer, updatePeerCount } from './tiles.js';
import { startExpiryCountdown } from './expiry.js';

// ─── LISTENERS ───────────────────────────────────────
export function setupPeerListeners() {
  state.myPeer.on('connection', (conn) => setupDataConn(conn, false));
  state.myPeer.on('call', (call) => {    console.log('[room] 📞 Incoming media call from', call.peer);    call.answer(state.localStream || new MediaStream());
    setupMediaConn(call);
  });
}

// ─── CONNECT TO PEER ─────────────────────────────────
export function connectToPeer(peerId, name) {
  if (peers.has(peerId) || peerId === state.myId) return;
  console.log('[room] connectToPeer →', peerId, '| stream tracks:', state.localStream?.getTracks().length ?? 'no stream');
  const dataConn = state.myPeer.connect(peerId, { reliable: true, metadata: { name: MY_NAME } });
  setupDataConn(dataConn, true);
  if (state.localStream?.getTracks().length > 0) {
    const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
    if (call) setupMediaConn(call);
  } else {
    console.warn('[room] ⚠️ No local stream tracks — skipping media call to', peerId);
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
    console.log('[room] Data conn OPEN with', peerId, '| name:', peerName, '| isHost:', state.isHost);

    if (peerName === '__overlay__') {
      console.log('[room] Overlay detected:', peerId);
      entry.isOverlay = true;
      if (state.localStream?.getTracks().length > 0 && !entry.mediaConn) {
        console.log('[room] Calling overlay with media now');
        const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
        if (call) setupMediaConn(call);
      }
    } else {
      // For regular peers — proactively call them so we don't rely solely on the
      // joiner's call. Both sides calling each other is fine: the stale-call guard
      // in setupMediaConn handles any duplicate, and the first ICE that connects wins.
      if (state.localStream?.getTracks().length > 0 && !entry.mediaConn) {
        console.log('[room] Proactively calling peer with media:', peerId);
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

      // Send existing peer list — overlays only need real (non-overlay) peers
      const peerList = [];
      peers.forEach((e, id) => {
        if (id !== peerId && id !== state.myId && !e.isOverlay)
          peerList.push({ id, name: peerNames.get(id) || id });
      });
      conn.send({ type: 'peers', peers: peerList });

      // Room expiry
      const stored = localStorage.getItem('room-expiry-' + ROOM_ID);
      if (stored) conn.send({ type: 'room-info', expiresAt: parseInt(stored) });

      // Don't announce overlay joins to other overlays — they'd try to connect
      // to each other, wasting their 2 display slots.
      if (peerName !== '__overlay__')
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
  let everConnected = false; // track whether ICE ever reached 'connected'

  call.on('stream', (remoteStream) => {
    const name = call.metadata?.name || peerNames.get(peerId) || peerId;
    setPeerName(peerId, name);
    setRemoteStream(peerId, remoteStream);
  });

  call.on('iceStateChanged', (iceState) => {
    console.log('[ICE] peerId:', peerId, '| state:', iceState);

    if (iceState === 'connected' || iceState === 'completed') {
      everConnected = true;
      console.log('[ICE] ✅ Connected to', peerId);
    } else if (iceState === 'disconnected') {
      // Give the connection a chance to recover on its own.
      // If it's still disconnected after the timeout, remove the peer immediately.
      const delay = everConnected ? 4000 : 1500;
      console.warn('[ICE] Disconnected from', peerId, '(everConnected:', everConnected, ') — removing in', delay, 'ms if not recovered');
      setTimeout(() => {
        const entry = peers.get(peerId);
        if (!entry || entry.mediaConn !== call) return; // already handled
        const iceNow = call.peerConnection?.iceConnectionState;
        if (iceNow === 'disconnected' || iceNow === 'failed' || iceNow === 'closed') {
          console.warn('[ICE] Still disconnected — removing peer', peerId);
          handlePeerDisconnect(peerId);
        }
      }, delay);
    } else if (iceState === 'failed') {
      console.warn('[ICE] Failed for', peerId, '— removing peer immediately');
      setTimeout(() => {
        if (peers.get(peerId)?.mediaConn === call) handlePeerDisconnect(peerId);
      }, 500);
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
  // If data conn is gone the peer has left — just clean up.
  if (!entry.dataConn?.open) {
    console.log('[room] Data conn gone for', peerId, '— removing stale peer');
    removePeer(peerId);
    return;
  }
  // Close the stale call
  if (entry.mediaConn) { try { entry.mediaConn.close(); } catch {} entry.mediaConn = null; }
  // BOTH sides call each other — no lexicographic guard.
  // The stale-call guard in setupMediaConn (entry.mediaConn !== call) ensures
  // only the call that connected last survives; the other's 'close' is ignored.
  console.log('[room] Reconnecting media to', peerId);
  const call = state.myPeer.call(peerId, state.localStream, { metadata: { name: MY_NAME } });
  if (call) setupMediaConn(call);
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
  // If the host just left and we’re a regular peer, trigger migration

  if (!state.isHost && peerId === 'studio-' + ROOM_ID) {
    state.onHostLeft?.();
  }
}

export function broadcastData(msg, excludeId) {
  peers.forEach((entry, id) => {
    if (id !== excludeId && entry.dataConn?.open) {
      try { entry.dataConn.send(msg); } catch {}
    }
  });
}
