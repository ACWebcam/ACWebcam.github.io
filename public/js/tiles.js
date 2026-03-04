import { state, peers, peerNames } from './state.js';
import { escHtml, getInitial } from './utils.js';

// Show/hide the no-video overlay based on whether the stream has active video tracks.
// Also watches for future tracks being added/removed.
function syncNoVideo(tile, stream) {
  const noVid = tile.querySelector('.tile-no-video');
  if (!noVid) return;

  function update() {
    const hasVideo = stream.getVideoTracks().some(t => t.enabled && t.readyState !== 'ended');
    noVid.style.display = hasVideo ? 'none' : 'flex';
  }

  update();
  stream.addEventListener('addtrack',    update);
  stream.addEventListener('removetrack', update);
  // Also react to track mute/unmute (e.g. remote disables camera)
  stream.getVideoTracks().forEach(t => {
    t.addEventListener('mute',   update);
    t.addEventListener('unmute', update);
    t.addEventListener('ended',  update);
  });
}

export function setPeerName(id, name) {
  peerNames.set(id, name);
  const el = document.getElementById('tile-' + id);
  if (el) {
    const label = el.querySelector('.tile-name');
    if (label) label.textContent = name;
    // Update avatar letter in case name just arrived
    const avatar = el.querySelector('.tile-avatar');
    if (avatar) avatar.textContent = getInitial(name);
    const noVidName = el.querySelector('.tile-no-video span');
    if (noVidName) noVidName.textContent = name;
  }
}

export function addLocalTile(stream, name) {
  const tile = createTile('local', name, true);
  const vid = tile.querySelector('video');
  vid.srcObject = stream;
  syncNoVideo(tile, stream);
  document.getElementById('videoGrid').prepend(tile);
  updatePeerCount();
}

export function setRemoteStream(peerId, stream) {
  let tile = document.getElementById('tile-' + peerId);
  if (!tile) {
    tile = createTile(peerId, peerNames.get(peerId) || peerId, false);
    document.getElementById('videoGrid').appendChild(tile);
    updatePeerCount();
  }
  tile.querySelector('video').srcObject = stream;
  syncNoVideo(tile, stream);
}

export function createTile(id, name, isLocal) {
  const tile = document.createElement('div');
  tile.className = 'video-tile' + (isLocal ? ' local' : '');
  tile.id        = 'tile-' + id;

  const vid = document.createElement('video');
  vid.autoplay    = true;
  vid.playsInline = true;
  if (isLocal) vid.muted = true;
  tile.appendChild(vid);

  const label = document.createElement('div');
  label.className = 'tile-label';
  label.innerHTML =
    '<span class="dot' + (state.audioMuted && isLocal ? ' muted' : '') + '"></span>' +
    '<span class="tile-name">' + escHtml(name) + '</span>' +
    (isLocal ? ' <span style="opacity:.6">(Ty)</span>' : '');
  tile.appendChild(label);

  const noVid = document.createElement('div');
  noVid.className    = 'tile-no-video';
  noVid.style.display = 'none';
  noVid.innerHTML    =
    '<div class="tile-avatar">' + getInitial(name) + '</div><span>' + escHtml(name) + '</span>';
  tile.appendChild(noVid);

  return tile;
}

export function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    if (entry.mediaConn) try { entry.mediaConn.close(); } catch {}
    if (entry.dataConn)  try { entry.dataConn.close();  } catch {}
    peers.delete(peerId);
  }
  document.getElementById('tile-' + peerId)?.remove();
  peerNames.delete(peerId);
  updatePeerCount();
}

export function updateLocalDot() {
  const dot = document.querySelector('#tile-local .dot');
  if (dot) dot.classList.toggle('muted', state.audioMuted);
}

export function updatePeerCount() {
  const count = document.querySelectorAll('.video-tile').length;
  document.getElementById('peerCountEl').textContent = count;
  const grid = document.getElementById('videoGrid');
  if      (count === 1) grid.style.gridTemplateColumns = '1fr';
  else if (count <= 4)  grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  else                  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
}
