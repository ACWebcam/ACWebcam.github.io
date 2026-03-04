import { ROOM_ID, getRoomLink, getObsLink } from './config.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { updateLocalDot } from './tiles.js';

export function toggleMic() {
  state.audioMuted = !state.audioMuted;
  state.localStream?.getAudioTracks().forEach(t => t.enabled = !state.audioMuted);
  const btn = document.getElementById('btnMic');
  btn.textContent = state.audioMuted ? '🔇' : '🎤';
  btn.classList.toggle('danger', state.audioMuted);
  btn.classList.toggle('active', state.audioMuted);
  document.getElementById('micLabel').textContent = state.audioMuted ? 'Ztlumit' : 'Mikrofon';
  updateLocalDot();
}

export function toggleCam() {
  state.videoOff = !state.videoOff;
  state.localStream?.getVideoTracks().forEach(t => t.enabled = !state.videoOff);
  const btn = document.getElementById('btnCam');
  btn.textContent = state.videoOff ? '🚫' : '📷';
  btn.classList.toggle('danger', state.videoOff);
  btn.classList.toggle('active', state.videoOff);
  document.getElementById('camLabel').textContent = state.videoOff ? 'Kamera vyp.' : 'Kamera';
  document.querySelector('#tile-local .tile-no-video')?.style.setProperty('display', state.videoOff ? 'flex' : 'none');
}

export function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('open');
  document.getElementById('btnSettings').classList.toggle('active');
}

export function leaveRoom() {
  if (state.myPeer) state.myPeer.destroy();
  state.localStream?.getTracks().forEach(t => t.stop());
  window.location.href = 'index.html';
}

export function openOverlay() {
  window.open('overlay.html?room=' + ROOM_ID, '_blank');
}

export function copyRoomLink() {
  navigator.clipboard.writeText(getRoomLink())
    .then(()  => showToast('✅ Odkaz zkopírován!'))
    .catch(()  => showToast('⚠️ Kopírování selhalo'));
}

export function copyRoomCode() {
  navigator.clipboard.writeText(ROOM_ID)
    .then(()  => showToast('✅ Kód místnosti zkopírován: ' + ROOM_ID))
    .catch(()  => showToast('⚠️ Kopírování selhalo'));
}

export function copyObsLink() {
  navigator.clipboard.writeText(getObsLink())
    .then(()  => showToast('✅ OBS odkaz zkopírován!'))
    .catch(()  => showToast('⚠️ Kopírování selhalo'));
}
