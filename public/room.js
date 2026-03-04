/* ====================================================
   WebRTC Studio – room.js  (PeerJS – serverless)
   ==================================================== */

// ─── PARAMS ─────────────────────────────────────────
const params     = new URLSearchParams(window.location.search);
const ROOM_ID    = params.get('room') || 'default';
const MY_NAME    = params.get('name') || localStorage.getItem('webrtc-name') || 'Anon';
const OBS_MODE   = params.get('obs') === '1';
const ROOM_EXPIRY = params.get('expiry') ? parseInt(params.get('expiry')) : null;

// ─── ROZLIŠENÍ ──────────────────────────────────────
const RES_MAP = {
  '360p':  { width: 640,  height: 360  },
  '480p':  { width: 854,  height: 480  },
  '720p':  { width: 1280, height: 720  },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k':    { width: 3840, height: 2160 }
};

// ─── STAV ────────────────────────────────────────────
let myPeer     = null;   // PeerJS instance
let myId       = null;
let isHost     = false;
let localStream = null;
let screenStream = null;
let isScreenSharing = false;

let audioMuted = false;
let videoOff   = false;

// peerId -> { dataConn, mediaConn }
const peers = new Map();
const peerNames = new Map();

// BroadcastChannel pro overlay-sync ve stejném prohlížeči
const overlayBC = new BroadcastChannel('overlay-sync-' + ROOM_ID);

function getHostId() { return 'studio-' + ROOM_ID; }

// ─── INIT ────────────────────────────────────────────
async function init() {
  if (OBS_MODE) {
    document.body.classList.add('obs-mode');
  }

  document.getElementById('displayRoomId').textContent = ROOM_ID;
  document.getElementById('roomLinkInput').value  = getRoomLink();
  document.getElementById('obsLinkInput').value   = getObsLink();

  // Získej média
  try {
    localStream = await getMedia();
    addLocalTile(localStream);
    populateDevices();
  } catch (err) {
    showToast('⚠️ Kamera/mikrofon nedostupné: ' + err.message);
    localStream = new MediaStream();
    addLocalTile(localStream);
  }

  // Room expiration (client-side)
  handleRoomExpiry();

  // Start PeerJS
  connectPeerJS();

  // Zkontroluj overlay peers po připojení (pro případ, že se overlay připojil dřív než jsme měli stream)
  setTimeout(sendStreamToOverlays, 3000);
}

// ─── MEDIA ───────────────────────────────────────────
function getConstraints() {
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

async function getMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia(getConstraints());
  } catch {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
}

async function populateDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const camSel = document.getElementById('cameraSelect');
    const micSel = document.getElementById('micSelect');

    camSel.innerHTML = '';
    micSel.innerHTML = '';

    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${d.kind} (${d.deviceId.slice(0, 8)})`;
      if (d.kind === 'videoinput') camSel.appendChild(opt);
      if (d.kind === 'audioinput') micSel.appendChild(opt);
    });

    if (localStream) {
      const vt = localStream.getVideoTracks()[0];
      const at = localStream.getAudioTracks()[0];
      if (vt) camSel.value = vt.getSettings().deviceId;
      if (at) micSel.value = at.getSettings().deviceId;
    }
  } catch { /* ignoruj */ }
}

// ─── APLIKOVAT VIDEO NASTAVENÍ ───────────────────────
async function applyVideoSettings() {
  if (isScreenSharing) return;
  if (!localStream) return;

  try {
    const res = document.getElementById('resolutionSelect').value;
    const fps = parseInt(document.getElementById('fpsSelect').value);
    const { width, height } = RES_MAP[res];
    const vt = localStream.getVideoTracks()[0];

    if (vt) {
      await vt.applyConstraints({
        width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps }
      });
      await applyBitrate(false);
      showToast(`✅ ${res} @ ${fps}fps nastaveno`);
    }
  } catch (err) {
    showToast('⚠️ Rozlišení nepodporováno: ' + err.message);
  }
}

// ─── BITRATE ─────────────────────────────────────────
async function applyBitrate(notify = true) {
  const kbps = parseInt(document.getElementById('bitrateSelect')?.value || '0');
  const bps  = kbps > 0 ? kbps * 1000 : null;

  const promises = [];
  peers.forEach(({ mediaConn }) => {
    if (!mediaConn || !mediaConn.peerConnection) return;
    const pc = mediaConn.peerConnection;
    const sender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const pars = sender.getParameters();
    if (!pars.encodings || pars.encodings.length === 0) {
      pars.encodings = [{}];
    }
    pars.encodings.forEach(enc => {
      if (bps !== null) enc.maxBitrate = bps;
      else delete enc.maxBitrate;
    });
    promises.push(sender.setParameters(pars).catch(() => {}));
  });

  await Promise.all(promises);
  if (notify) {
    showToast(bps ? `✅ Bitrate nastaven na ${kbps} kbps` : '✅ Bitrate: Auto (neomezeno)');
  }
}

async function changeCamera() {
  if (isScreenSharing) return;
  const newStream = await getMedia();
  await replaceVideoTrack(newStream.getVideoTracks()[0]);
  localStream.getAudioTracks()[0]?.stop();
  newStream.getAudioTracks().forEach(t => localStream.addTrack(t));
  showToast('✅ Kamera přepnuta');
  sendStreamToOverlays();
}

async function changeMic() {
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: document.getElementById('micSelect').value } }
  });
  const newAt = newStream.getAudioTracks()[0];
  localStream.getAudioTracks().forEach(t => { localStream.removeTrack(t); t.stop(); });
  localStream.addTrack(newAt);
  await replaceAudioTrack(newAt);
  showToast('✅ Mikrofon přepnut');
}

// ─── ODESLAT STREAM DO OVERLAY PEERS ─────────────────
function sendStreamToOverlays() {
  if (!localStream || localStream.getTracks().length === 0) return;
  peers.forEach((entry, peerId) => {
    if (entry.isOverlay && !entry.mediaConn) {
      console.log('[room] Sending stream to overlay:', peerId);
      const mediaCall = myPeer.call(peerId, localStream, { metadata: { name: MY_NAME } });
      if (mediaCall) setupMediaConn(mediaCall);
    }
  });
}

// ─── NAHRADIT TRACK VE VŠECH PC ──────────────────────
async function replaceVideoTrack(newTrack) {
  localStream.getVideoTracks().forEach(t => { localStream.removeTrack(t); t.stop(); });
  if (newTrack) localStream.addTrack(newTrack);

  peers.forEach(({ mediaConn }) => {
    if (!mediaConn || !mediaConn.peerConnection) return;
    const sender = mediaConn.peerConnection.getSenders().find(s => s.track?.kind === 'video');
    if (sender && newTrack) sender.replaceTrack(newTrack);
  });

  const vid = document.querySelector('#tile-local video');
  if (vid) vid.srcObject = localStream;
}

async function replaceAudioTrack(newTrack) {
  peers.forEach(({ mediaConn }) => {
    if (!mediaConn || !mediaConn.peerConnection) return;
    const sender = mediaConn.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
    if (sender && newTrack) sender.replaceTrack(newTrack);
  });
}

// ─── TLAČÍTKA OVLÁDÁNÍ ───────────────────────────────
function toggleMic() {
  audioMuted = !audioMuted;
  localStream?.getAudioTracks().forEach(t => t.enabled = !audioMuted);
  const btn = document.getElementById('btnMic');
  btn.textContent = audioMuted ? '🔇' : '🎤';
  btn.classList.toggle('danger', audioMuted);
  btn.classList.toggle('active', audioMuted);
  document.getElementById('micLabel').textContent = audioMuted ? 'Ztlumit' : 'Mikrofon';
  updateLocalDot();
}

function toggleCam() {
  videoOff = !videoOff;
  localStream?.getVideoTracks().forEach(t => t.enabled = !videoOff);
  const btn = document.getElementById('btnCam');
  btn.textContent = videoOff ? '🚫' : '📷';
  btn.classList.toggle('danger', videoOff);
  btn.classList.toggle('active', videoOff);
  document.getElementById('camLabel').textContent = videoOff ? 'Kamera vyp.' : 'Kamera';
  const noVid = document.querySelector('#tile-local .tile-no-video');
  if (noVid) noVid.style.display = videoOff ? 'flex' : 'none';
}

async function toggleScreen() {
  if (isScreenSharing) stopScreenShare();
  else await startScreenShare();
}

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    isScreenSharing = true;
    await replaceVideoTrack(screenTrack);
    const tile = document.getElementById('tile-local');
    if (tile) tile.classList.add('screen-share');
    document.getElementById('btnScreen').classList.add('active');
    screenTrack.onended = () => stopScreenShare();
    showToast('🖥️ Sdílení obrazovky spuštěno');
  } catch (err) {
    showToast('⚠️ Sdílení obrazovky selhalo: ' + err.message);
  }
}

async function stopScreenShare() {
  isScreenSharing = false;
  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;
  try {
    const newStream = await getMedia();
    await replaceVideoTrack(newStream.getVideoTracks()[0]);
  } catch {}
  const tile = document.getElementById('tile-local');
  if (tile) tile.classList.remove('screen-share');
  document.getElementById('btnScreen').classList.remove('active');
  showToast('📷 Kamera obnovena');
  sendStreamToOverlays();
}

function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('open');
  document.getElementById('btnSettings').classList.toggle('active');
}

function leaveRoom() {
  if (myPeer) myPeer.destroy();
  localStream?.getTracks().forEach(t => t.stop());
  window.location.href = 'index.html';
}

// ─── ICE CONFIG (STUN + TURN pro cross-network) ─────
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    // openrelay is a free public TURN relay — use multiple endpoints for redundancy
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
        'turns:openrelay.metered.ca:443'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    // Backup public TURN (freeturn.net)
    {
      urls: [
        'turn:freeturn.net:3478',
        'turns:freeturn.net:5349'
      ],
      username: 'free',
      credential: 'free'
    }
  ],
  iceCandidatePoolSize: 10
};

// ─── PEERJS SIGNALING ────────────────────────────────
function connectPeerJS() {
  const hostId = getHostId();

  // Zkus se zaregistrovat jako host (tvůrce roomky)
  myPeer = new Peer(hostId, { debug: 0, config: ICE_CONFIG });

  myPeer.on('open', (id) => {
    myId = id;
    isHost = true;
    console.log('✅ Room created, I am host:', id);
    showToast('✅ Místnost vytvořena');
    setupPeerListeners();
  });

  myPeer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Host ID je zabraný — zkusíme se připojit jako joiner
      myPeer.destroy();
      myPeer = new Peer(undefined, { debug: 0, config: ICE_CONFIG });

      myPeer.on('open', (id) => {
        myId = id;
        isHost = false;
        console.log('✅ Joined as peer:', id);
        setupPeerListeners();
        connectToPeer(hostId, 'Host');
      });

      myPeer.on('error', (err2) => {
        if (err2.type === 'peer-unavailable') {
          // Host ID je stale/mrtvý (PeerJS cloud si ho drží ale nikdo tam není)
          // → počkej a zkus znovu převzít host roli
          console.warn('Host ID stale, retrying as host in 3s...');
          showToast('⏳ Připojování k místnosti...');
          setTimeout(() => {
            if (myPeer && !myPeer.destroyed) myPeer.destroy();
            connectPeerJS();
          }, 3000);
        } else {
          handlePeerError(err2);
        }
      });
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
    setTimeout(() => { if (myPeer && !myPeer.destroyed) myPeer.reconnect(); }, 2000);
  }
}

function setupPeerListeners() {
  myPeer.on('connection', (conn) => {
    setupDataConn(conn, false); // přijíamáme spojení — musíme zavolat zpět
  });

  myPeer.on('call', (call) => {
    // Vždy odpovíme s platným streamem — umožní obousměrný přenos
    call.answer(localStream || new MediaStream());
    setupMediaConn(call);
  });
}

function connectToPeer(peerId, name) {
  if (peers.has(peerId) || peerId === myId) return;

  const dataConn = myPeer.connect(peerId, { reliable: true, metadata: { name: MY_NAME } });
  setupDataConn(dataConn, true); // my jsme iniciátor — volaccí strana

  if (localStream && localStream.getTracks().length > 0) {
    const mediaCall = myPeer.call(peerId, localStream, { metadata: { name: MY_NAME } });
    if (mediaCall) setupMediaConn(mediaCall);
  }
}

function setupDataConn(conn, isInitiator) {
  const peerId = conn.peer;

  conn.on('open', () => {
    const entry = peers.get(peerId) || {};
    entry.dataConn = conn;
    entry.isOverlay = false;
    peers.set(peerId, entry);

    const peerName = conn.metadata?.name || peerNames.get(peerId) || peerId;
    setPeerName(peerId, peerName);

    if (peerName === '__overlay__') {
      // Overlay: vždy voláme my (overlay sám stream nemá)
      console.log('[room] Overlay detected:', peerId);
      entry.isOverlay = true;
      if (localStream && localStream.getTracks().length > 0 && !entry.mediaConn) {
        console.log('[room] Calling overlay with media now');
        const mediaCall = myPeer.call(peerId, localStream, { metadata: { name: MY_NAME } });
        if (mediaCall) setupMediaConn(mediaCall);
      }
    }
    // Žádný reverse call — PeerJS call je obousměrný.
    // Initiator volá v connectToPeer, receiver odpovídá v myPeer.on('call').

    if (isHost) {
      // Pošli novému peerovi seznam ostatních
      const peerList = [];
      peers.forEach((e, id) => {
        if (id !== peerId && id !== myId) {
          peerList.push({ id, name: peerNames.get(id) || id });
        }
      });
      conn.send({ type: 'peers', peers: peerList });

      // Room expiry
      const stored = localStorage.getItem('room-expiry-' + ROOM_ID);
      if (stored) conn.send({ type: 'room-info', expiresAt: parseInt(stored) });

      // Oznam ostatním
      broadcastData({ type: 'peer-joined', id: peerId, name: peerName }, peerId);
    }

    updatePeerCount();
  });

  conn.on('data', (data) => handleData(peerId, data));
  conn.on('close', () => handlePeerDisconnect(peerId));
  conn.on('error', () => {});
}

function setupMediaConn(call) {
  const peerId = call.peer;

  call.on('stream', (remoteStream) => {
    const name = call.metadata?.name || peerNames.get(peerId) || peerId;
    setPeerName(peerId, name);
    setRemoteStream(peerId, remoteStream);
  });

  // ICE state logging + restart-on-disconnect
  call.on('iceStateChanged', (state) => {
    console.log('[ICE] peerId:', peerId, '| state:', state);

    if (state === 'disconnected') {
      // ICE blip – try an in-place restart before giving up
      console.log('[ICE] Disconnected, scheduling restart for', peerId);
      setTimeout(() => {
        const entry = peers.get(peerId);
        // Only restart if this call is still the active one
        if (entry && entry.mediaConn === call) {
          const pc = call.peerConnection;
          if (pc && pc.signalingState !== 'closed' && pc.iceConnectionState !== 'connected') {
            console.log('[ICE] Restarting ICE for', peerId);
            pc.restartIce();
          }
        }
      }, 2500);
    } else if (state === 'failed') {
      showToast('⚠️ ICE failed – zkouším znovu spojení...');
      console.warn('[ICE] Failed for', peerId, '– renegotiating');
      setTimeout(() => {
        const entry = peers.get(peerId);
        if (entry && entry.mediaConn === call) reconnectMedia(peerId);
      }, 3000);
    } else if (state === 'connected' || state === 'completed') {
      console.log('[ICE] ✅ Connected to', peerId);
    }
  });

  // Guard: only remove the peer if THIS call is still the active media connection.
  // Old duplicate/stale calls (from cached browser code) must not kill valid peers.
  call.on('close', () => {
    const entry = peers.get(peerId);
    if (entry && entry.mediaConn === call) {
      handlePeerDisconnect(peerId);
    } else {
      console.log('[room] Ignoring close of stale/duplicate call for', peerId);
    }
  });
  call.on('error', () => {});

  const entry = peers.get(peerId) || {};
  entry.mediaConn = call;
  peers.set(peerId, entry);
}

// Re-initiate the media call for a peer whose ICE fully failed
function reconnectMedia(peerId) {
  if (!localStream || localStream.getTracks().length === 0) return;
  const entry = peers.get(peerId);
  if (!entry) return;

  // Close the failed connection
  if (entry.mediaConn) {
    try { entry.mediaConn.close(); } catch {}
    entry.mediaConn = null;
  }

  // Only the lexicographically larger ID initiates to avoid both sides calling each other
  if (myId > peerId) {
    console.log('[room] Reconnecting media to', peerId);
    const mediaCall = myPeer.call(peerId, localStream, { metadata: { name: MY_NAME } });
    if (mediaCall) setupMediaConn(mediaCall);
  }
}

function handleData(fromId, data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'peers':
      for (const p of data.peers) {
        if (!peers.has(p.id) && p.id !== myId) {
          setPeerName(p.id, p.name);
          connectToPeer(p.id, p.name);
        }
      }
      break;

    case 'peer-joined':
      // Jen zaregistruj jméno — nový peer se k nám připojí sám (přes peers list)
      setPeerName(data.id, data.name);
      break;

    case 'peer-left':
      removePeer(data.id);
      break;

    case 'name-change':
      setPeerName(data.id, data.name);
      break;

    case 'overlay-sync':
      overlayBC.postMessage({ cam: data.cam, settings: data.settings });
      break;

    case 'room-info':
      startExpiryCountdown(data.expiresAt);
      break;

    case 'room-expired':
      alert('⏰ Platnost místnosti vypršela.');
      window.location.href = 'index.html';
      break;
  }
}

function handlePeerDisconnect(peerId) {
  removePeer(peerId);
  if (isHost) broadcastData({ type: 'peer-left', id: peerId }, peerId);
}

function broadcastData(msg, excludeId) {
  peers.forEach((entry, id) => {
    if (id !== excludeId && entry.dataConn && entry.dataConn.open) {
      try { entry.dataConn.send(msg); } catch {}
    }
  });
}

// ─── DOČASNÁ MAPA JMEN ──────────────────────────────
function setPeerName(id, name) {
  peerNames.set(id, name);
  const el = document.getElementById('tile-' + id);
  if (el) {
    const label = el.querySelector('.tile-name');
    if (label) label.textContent = name;
  }
}

// ─── VIDEO TILES ─────────────────────────────────────
function addLocalTile(stream) {
  const tile = createTile('local', MY_NAME, true);
  const vid = tile.querySelector('video');
  vid.srcObject = stream;
  document.getElementById('videoGrid').prepend(tile);
  updatePeerCount();
}

function setRemoteStream(peerId, stream) {
  let tile = document.getElementById('tile-' + peerId);
  if (!tile) {
    const name = peerNames.get(peerId) || peerId;
    tile = createTile(peerId, name, false);
    document.getElementById('videoGrid').appendChild(tile);
    updatePeerCount();
  }
  const vid = tile.querySelector('video');
  vid.srcObject = stream;
}

function createTile(id, name, isLocal) {
  const tile = document.createElement('div');
  tile.className = 'video-tile' + (isLocal ? ' local' : '');
  tile.id = 'tile-' + id;

  const vid = document.createElement('video');
  vid.autoplay = true;
  vid.playsInline = true;
  if (isLocal) vid.muted = true;
  tile.appendChild(vid);

  const label = document.createElement('div');
  label.className = 'tile-label';
  label.innerHTML = '<span class="dot' + (audioMuted && isLocal ? ' muted' : '') + '"></span>' +
                    '<span class="tile-name">' + escHtml(name) + '</span>' +
                    (isLocal ? ' <span style="opacity:.6">(Ty)</span>' : '');
  tile.appendChild(label);

  const noVid = document.createElement('div');
  noVid.className = 'tile-no-video';
  noVid.style.display = 'none';
  noVid.innerHTML = '<div class="tile-avatar">' + getInitial(name) + '</div><span>' + escHtml(name) + '</span>';
  tile.appendChild(noVid);

  return tile;
}

function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    if (entry.mediaConn) try { entry.mediaConn.close(); } catch {}
    if (entry.dataConn)  try { entry.dataConn.close(); }  catch {}
    peers.delete(peerId);
  }
  const tile = document.getElementById('tile-' + peerId);
  if (tile) tile.remove();
  peerNames.delete(peerId);
  updatePeerCount();
}

function updateLocalDot() {
  const dot = document.querySelector('#tile-local .dot');
  if (dot) dot.classList.toggle('muted', audioMuted);
}

function updatePeerCount() {
  const count = document.querySelectorAll('.video-tile').length;
  document.getElementById('peerCountEl').textContent = count;
  const grid = document.getElementById('videoGrid');
  if (count === 1) grid.style.gridTemplateColumns = '1fr';
  else if (count === 2) grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  else if (count <= 4) grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  else grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
}

// ─── SDÍLENÍ ODKAZŮ ──────────────────────────────────
function getRoomLink() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'room.html?room=' + ROOM_ID;
}
function getObsLink() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'overlay.html?room=' + ROOM_ID + '&obs=1';
}

function copyRoomLink() {
  navigator.clipboard.writeText(getRoomLink())
    .then(() => showToast('✅ Odkaz zkopírován!'))
    .catch(() => showToast('⚠️ Kopírování selhalo'));
}
function copyRoomCode() {
  navigator.clipboard.writeText(ROOM_ID)
    .then(() => showToast('✅ Kód místnosti zkopírován: ' + ROOM_ID))
    .catch(() => showToast('⚠️ Kopírování selhalo'));
}
function copyObsLink() {
  navigator.clipboard.writeText(getObsLink())
    .then(() => showToast('✅ OBS odkaz zkopírován!'))
    .catch(() => showToast('⚠️ Kopírování selhalo'));
}

// ─── ROOM EXPIRY (Client-side) ──────────────────────
function handleRoomExpiry() {
  if (ROOM_EXPIRY) {
    const existing = localStorage.getItem('room-expiry-' + ROOM_ID);
    if (!existing) {
      const expiresAt = Date.now() + ROOM_EXPIRY * 60 * 1000;
      localStorage.setItem('room-expiry-' + ROOM_ID, String(expiresAt));
    }
  }
  const expiresAt = localStorage.getItem('room-expiry-' + ROOM_ID);
  if (expiresAt) {
    const ts = parseInt(expiresAt);
    if (ts <= Date.now()) {
      alert('⏰ Platnost místnosti vypršela.');
      localStorage.removeItem('room-expiry-' + ROOM_ID);
      window.location.href = 'index.html';
      return;
    }
    startExpiryCountdown(ts);
  }
}

// ─── TOAST ───────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  if (OBS_MODE) return;
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── UTILS ───────────────────────────────────────────
function getInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── EXPIRY COUNTDOWN ────────────────────────────────
let expiryInterval = null;
function startExpiryCountdown(expiresAt) {
  const wrap = document.getElementById('roomExpiry');
  const el   = document.getElementById('expiryCountdown');
  if (!wrap || !el) return;
  wrap.style.display = '';

  function tick() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      el.textContent = 'Vypršelo';
      wrap.style.color = '#ff4444';
      clearInterval(expiryInterval);
      alert('⏰ Platnost místnosti vypršela.');
      localStorage.removeItem('room-expiry-' + ROOM_ID);
      window.location.href = 'index.html';
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    let text = '';
    if (d > 0) text += d + 'd ';
    if (h > 0 || d > 0) text += h + 'h ';
    text += m + 'm ' + s + 's';
    el.textContent = text.trim();

    wrap.style.color = diff < 3600000 ? '#ff8844' : '';
  }

  tick();
  if (expiryInterval) clearInterval(expiryInterval);
  expiryInterval = setInterval(tick, 1000);
}

// ─── START ───────────────────────────────────────────
init();
