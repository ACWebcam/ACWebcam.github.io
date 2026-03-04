import { RES_MAP } from './config.js';
import { state, peers } from './state.js';
import { showToast } from './utils.js';
import { sendStreamToOverlays } from './peers.js';

// ─── CONSTRAINTS ─────────────────────────────────────
export function getConstraints() {
  const res = document.getElementById('resolutionSelect')?.value || '720p';
  const fps = parseInt(document.getElementById('fpsSelect')?.value || '30');
  const cam = document.getElementById('cameraSelect')?.value;
  const mic = document.getElementById('micSelect')?.value;
  const { width, height } = RES_MAP[res];
  return {
    video: {
      width:     { ideal: width },
      height:    { ideal: height },
      frameRate: { ideal: fps },
      ...(cam ? { deviceId: { exact: cam } } : {})
    },
    audio: mic ? { deviceId: { exact: mic } } : true
  };
}

export async function getMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia(getConstraints());
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
}

// ─── DEVICE PICKER ───────────────────────────────────
export async function populateDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camSel  = document.getElementById('cameraSelect');
    const micSel  = document.getElementById('micSelect');
    camSel.innerHTML = '';
    micSel.innerHTML = '';
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${d.kind} (${d.deviceId.slice(0, 8)})`;
      if (d.kind === 'videoinput') camSel.appendChild(opt);
      if (d.kind === 'audioinput') micSel.appendChild(opt);
    });
    if (state.localStream) {
      const vt = state.localStream.getVideoTracks()[0];
      const at = state.localStream.getAudioTracks()[0];
      if (vt) camSel.value = vt.getSettings().deviceId;
      if (at) micSel.value = at.getSettings().deviceId;
    }
  } catch { /* ignore */ }
}

// ─── VIDEO SETTINGS ───────────────────────────────────
export async function applyVideoSettings() {
  if (state.isScreenSharing || !state.localStream) return;
  try {
    const res = document.getElementById('resolutionSelect').value;
    const fps = parseInt(document.getElementById('fpsSelect').value);
    const { width, height } = RES_MAP[res];
    const vt = state.localStream.getVideoTracks()[0];
    if (vt) {
      await vt.applyConstraints({ width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } });
      await applyBitrate(false);
      showToast(`✅ ${res} @ ${fps}fps nastaveno`);
    }
  } catch (err) {
    showToast('⚠️ Rozlišení nepodporováno: ' + err.message);
  }
}

// ─── BITRATE ─────────────────────────────────────────
export async function applyBitrate(notify = true) {
  const kbps = parseInt(document.getElementById('bitrateSelect')?.value || '0');
  const bps  = kbps > 0 ? kbps * 1000 : null;
  const promises = [];
  peers.forEach(({ mediaConn }) => {
    if (!mediaConn?.peerConnection) return;
    const sender = mediaConn.peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings.forEach(enc => { if (bps !== null) enc.maxBitrate = bps; else delete enc.maxBitrate; });
    promises.push(sender.setParameters(params).catch(() => {}));
  });
  await Promise.all(promises);
  if (notify) showToast(bps ? `✅ Bitrate nastaven na ${kbps} kbps` : '✅ Bitrate: Auto (neomezeno)');
}

// ─── TRACK REPLACEMENT ───────────────────────────────
export async function replaceVideoTrack(newTrack) {
  state.localStream.getVideoTracks().forEach(t => { state.localStream.removeTrack(t); t.stop(); });
  if (newTrack) state.localStream.addTrack(newTrack);
  peers.forEach(({ mediaConn }) => {
    if (!mediaConn?.peerConnection) return;
    const sender = mediaConn.peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (sender && newTrack) sender.replaceTrack(newTrack);
  });
  const vid = document.querySelector('#tile-local video');
  if (vid) vid.srcObject = state.localStream;
}

export async function replaceAudioTrack(newTrack) {
  peers.forEach(({ mediaConn }) => {
    if (!mediaConn?.peerConnection) return;
    const sender = mediaConn.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
    if (sender && newTrack) sender.replaceTrack(newTrack);
  });
}

// ─── CAMERA / MIC CHANGE ─────────────────────────────
export async function changeCamera() {
  if (state.isScreenSharing) return;
  const newStream = await getMedia();
  await replaceVideoTrack(newStream.getVideoTracks()[0]);
  state.localStream.getAudioTracks()[0]?.stop();
  newStream.getAudioTracks().forEach(t => state.localStream.addTrack(t));
  showToast('✅ Kamera přepnuta');
  sendStreamToOverlays();
}

export async function changeMic() {
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: document.getElementById('micSelect').value } }
  });
  const newAt = newStream.getAudioTracks()[0];
  state.localStream.getAudioTracks().forEach(t => { state.localStream.removeTrack(t); t.stop(); });
  state.localStream.addTrack(newAt);
  await replaceAudioTrack(newAt);
  showToast('✅ Mikrofon přepnut');
}

// ─── SCREEN SHARE ────────────────────────────────────
export async function startScreenShare() {
  try {
    state.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const track = state.screenStream.getVideoTracks()[0];
    state.isScreenSharing = true;
    await replaceVideoTrack(track);
    document.getElementById('tile-local')?.classList.add('screen-share');
    document.getElementById('btnScreen').classList.add('active');
    track.onended = () => stopScreenShare();
    showToast('🖥️ Sdílení obrazovky spuštěno');
  } catch (err) {
    showToast('⚠️ Sdílení obrazovky selhalo: ' + err.message);
  }
}

export async function stopScreenShare() {
  state.isScreenSharing = false;
  state.screenStream?.getTracks().forEach(t => t.stop());
  state.screenStream = null;
  try { await replaceVideoTrack((await getMedia()).getVideoTracks()[0]); } catch {}
  document.getElementById('tile-local')?.classList.remove('screen-share');
  document.getElementById('btnScreen').classList.remove('active');
  showToast('📷 Kamera obnovena');
  sendStreamToOverlays();
}

export async function toggleScreen() {
  if (state.isScreenSharing) await stopScreenShare();
  else await startScreenShare();
}
