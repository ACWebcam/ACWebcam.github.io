import { ROOM_ID, ICE_CONFIG, getHostId } from './config.js';
import { state, peers } from './state.js';
import { showToast } from './utils.js';
import { setupPeerListeners, connectToPeer, sendStreamToOverlays, syncPeersToOverlays } from './peers.js';

// ─── BOOTSTRAP ───────────────────────────────────────
// Try to claim studio-ROOMID as host.
// If the ID is taken, fall back to joinAsRegularPeer().
export function connectPeerJS() {
  // Register host-migration callback so peers.js can trigger it without a circular import
  state.onHostLeft = promoteToHost;

  const hostId = getHostId();
  state.myPeer = new Peer(hostId, { debug: 0, config: ICE_CONFIG });

  state.myPeer.on('open', (id) => {
    state.myId   = id;
    state.isHost = true;
    console.log('[room] ⭐ Jsi host:', id);
    showToast('✅ Místnost vytvořena');
    setupPeerListeners();
    syncPeersToOverlays();
    sendStreamToOverlays();
  });

  state.myPeer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Someone else already holds the host ID — join as regular peer.
      state.myPeer.destroy();
      joinAsRegularPeer();
    } else {
      handlePeerError(err);
    }
  });
}

// ─── JOIN AS REGULAR PEER ────────────────────────────
export function joinAsRegularPeer() {
  const hostId = getHostId();
  state.myPeer = new Peer(undefined, { debug: 0, config: ICE_CONFIG });

  state.myPeer.on('open', (id) => {
    state.myId   = id;
    state.isHost = false;
    console.log('[room] ✅ Joined as peer:', id);
    setupPeerListeners();
    connectToPeer(hostId, 'Host');
  });

  state.myPeer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      // Host ID not on broker — host may have just left.
      // Wait briefly then try to become host ourselves.
      console.warn('[room] Host not found, attempting takeover in 2s...');
      showToast('⏳ Připojování...');
      setTimeout(() => {
        if (state.myPeer && !state.myPeer.destroyed) {
          state.myPeer.destroy();
          peers.clear();
          connectPeerJS();
        }
      }, 2000 + Math.random() * 1000); // jitter so multiple peers don’t all grab at once
    } else {
      handlePeerError(err);
    }
  });
}

// ─── HOST MIGRATION ───────────────────────────────────
// Called when the current host peer disconnects.
// Destroy our current peer connection and race to claim studio-ROOMID.
// Only one peer wins; the rest fall back to joinAsRegularPeer() automatically.
export function promoteToHost() {
  if (state.isHost) return; // we are already host
  console.log('[room] 👑 Host odešel — pokus o převzetí role hosta...');
  showToast('⏳ Host odešel, přebírám místnost...');
  // Small random delay so multiple remaining peers don’t all try at the exact same ms
  setTimeout(() => {
    if (state.myPeer && !state.myPeer.destroyed) {
      state.myPeer.destroy();
      peers.clear();
    }
    connectPeerJS();
  }, Math.random() * 800);
}

// ─── ERROR HANDLER ────────────────────────────────────
function handlePeerError(err) {
  console.error('[room] PeerJS error:', err.type, err.message);
  if (err.type === 'disconnected' || err.type === 'network') {
    showToast('⚠️ Spojení ztraceno, obnovuji...');
    setTimeout(() => { if (state.myPeer && !state.myPeer.destroyed) state.myPeer.reconnect(); }, 2000);
  }
}

// Keep connectSignalingServer as a no-op so main.js import still works
export function connectSignalingServer() {}
export function sigSend() {}

}
