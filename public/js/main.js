import { ROOM_ID, MY_NAME, OBS_MODE, getRoomLink, getObsLink } from './config.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { addLocalTile } from './tiles.js';
import { handleRoomExpiry } from './expiry.js';
import { getMedia, populateDevices, applyVideoSettings, applyBitrate, changeCamera, changeMic, toggleScreen } from './media.js';
import { sendStreamToOverlays } from './peers.js';
import { connectSignalingServer, connectPeerJS } from './signaling.js';
import { toggleMic, toggleCam, toggleSettings, leaveRoom, openOverlay, copyRoomLink, copyRoomCode, copyObsLink } from './ui.js';

// ─── EXPOSE FUNCTIONS FOR HTML onclick ATTRIBUTES ────
// ES modules are scoped — attach anything used by inline handlers to window.
Object.assign(window, {
  toggleMic, toggleCam, toggleSettings, leaveRoom, openOverlay,
  copyRoomLink, copyRoomCode, copyObsLink,
  applyVideoSettings, applyBitrate, changeCamera, changeMic, toggleScreen,
  ROOM_ID   // used by settings panel link generation
});

// ─── INIT ─────────────────────────────────────────────
async function init() {
  if (OBS_MODE) document.body.classList.add('obs-mode');

  document.getElementById('displayRoomId').textContent = ROOM_ID;
  document.getElementById('roomLinkInput').value       = getRoomLink();
  document.getElementById('obsLinkInput').value        = getObsLink();

  // BroadcastChannel for overlay filter sync (same browser, different tabs)
  state.overlayBC = new BroadcastChannel('overlay-sync-' + ROOM_ID);

  // Acquire camera + mic
  try {
    state.localStream = await getMedia();
    addLocalTile(state.localStream, MY_NAME);
    populateDevices();
  } catch (err) {
    showToast('⚠️ Kamera/mikrofon nedostupné: ' + err.message);
    state.localStream = new MediaStream();
    addLocalTile(state.localStream, MY_NAME);
  }

  handleRoomExpiry();

  // Connect to WS server (host-claim registry) then to PeerJS
  connectSignalingServer();
  connectPeerJS();

  // Fallback: push stream to overlays that joined before our stream was ready
  setTimeout(sendStreamToOverlays, 3000);
}

init();
