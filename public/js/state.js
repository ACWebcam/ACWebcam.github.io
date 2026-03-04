// ─── MUTABLE RUNTIME STATE ───────────────────────────
// Exported as object properties so any module can mutate them
// without ES module live-binding restrictions on primitives.
export const state = {
  myPeer:          null,   // PeerJS instance
  myId:            null,   // our PeerJS ID
  isHost:          false,
  localStream:     null,   // MediaStream from camera/mic
  screenStream:    null,   // MediaStream from screen share
  isScreenSharing: false,
  audioMuted:      false,
  videoOff:        false,
  overlayBC:       null,   // BroadcastChannel for overlay sync
  onHostLeft:      null,   // callback → set by signaling.js for host migration
};

// peerId -> { dataConn, mediaConn, isOverlay }
export const peers     = new Map();
// peerId -> display name
export const peerNames = new Map();
