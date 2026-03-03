/* ============================================================
   overlay-viewer.js – Academy Clash Overlay logic
   PeerJS viewer + filtr kamer + sync přes BroadcastChannel
   ============================================================ */

const PARAMS   = new URLSearchParams(window.location.search);
const ROOM_ID  = PARAMS.get('room');
const OBS_MODE = PARAMS.get('obs') === '1';

// ── SCENE SCALE ─────────────────────────────────────────────
function scaleScene() {
  var scene = document.getElementById('scene');
  var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  var ox = (window.innerWidth  - 1920 * scale) / 2;
  var oy = (window.innerHeight - 1080 * scale) / 2;
  scene.style.transform = 'translate(' + ox + 'px, ' + oy + 'px) scale(' + scale + ')';
}
scaleScene();
window.addEventListener('resize', scaleScene);

if (OBS_MODE) document.documentElement.classList.add('obs-mode');

// ── COLOR PANEL ─────────────────────────────────────────────
function toggleColorPanel() {
  var panel = document.getElementById('color-panel');
  var btn   = document.getElementById('gear-btn');
  if (!panel) return;
  var isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  btn.classList.toggle('open', !isOpen);
}

// BroadcastChannel pro sync filtrů (stejný prohlížeč)
var overlayBC = ROOM_ID ? new BroadcastChannel('overlay-sync-' + ROOM_ID) : null;

/**
 * Přečte hodnoty sliderů, aplikuje CSS filtr na video
 * a broadcastuje stav přes BroadcastChannel (do OBS tabu).
 */
function updateFilter(n, broadcast) {
  var vid = document.getElementById('cam-video-' + n);
  if (!vid) return;

  var br  = document.getElementById('c' + n + '-brightness').value;
  var co  = document.getElementById('c' + n + '-contrast').value;
  var sa  = document.getElementById('c' + n + '-saturate').value;
  var hu  = document.getElementById('c' + n + '-hue').value;
  var mir = document.getElementById('c' + n + '-mirror').checked;

  document.getElementById('c' + n + '-brightness-val').textContent = br + '%';
  document.getElementById('c' + n + '-contrast-val').textContent   = co + '%';
  document.getElementById('c' + n + '-saturate-val').textContent   = sa + '%';
  document.getElementById('c' + n + '-hue-val').textContent        = hu + '°';

  applyFilterToVideo(vid, { br: br, co: co, sa: sa, hu: hu, mir: mir });

  // Broadcast přes BroadcastChannel (do OBS a dalších tabů)
  if (broadcast !== false && overlayBC) {
    overlayBC.postMessage({ cam: n, settings: { br: br, co: co, sa: sa, hu: hu, mir: mir } });
  }

  // Taky pošli přes PeerJS data channels (pro cross-browser sync)
  if (broadcast !== false && typeof broadcastDataOverlay === 'function') {
    broadcastDataOverlay({ type: 'overlay-sync', cam: n, settings: { br: br, co: co, sa: sa, hu: hu, mir: mir } });
  }
}

function applyFilterToVideo(vid, s) {
  vid.style.setProperty('filter',
    'brightness(' + s.br + '%) contrast(' + s.co + '%) saturate(' + s.sa + '%) hue-rotate(' + s.hu + 'deg)',
    'important');
  vid.style.setProperty('transform', s.mir ? 'scaleX(-1)' : 'scaleX(1)', 'important');
}

/** Aplikuje přijatý stav filtru z jiného tabu */
function applyRemoteFilter(cam, s) {
  var br  = s.br  != null ? s.br  : 100;
  var co  = s.co  != null ? s.co  : 100;
  var sa  = s.sa  != null ? s.sa  : 100;
  var hu  = s.hu  != null ? s.hu  : 0;
  var mir = s.mir !== false;

  var elBr = document.getElementById('c' + cam + '-brightness');
  var elCo = document.getElementById('c' + cam + '-contrast');
  var elSa = document.getElementById('c' + cam + '-saturate');
  var elHu = document.getElementById('c' + cam + '-hue');
  var elMi = document.getElementById('c' + cam + '-mirror');
  if (elBr) elBr.value   = br;
  if (elCo) elCo.value   = co;
  if (elSa) elSa.value   = sa;
  if (elHu) elHu.value   = hu;
  if (elMi) elMi.checked = mir;

  var vid = document.getElementById('cam-video-' + cam);
  if (vid) applyFilterToVideo(vid, { br: br, co: co, sa: sa, hu: hu, mir: mir });

  var bv = document.getElementById('c' + cam + '-brightness-val');
  var cv = document.getElementById('c' + cam + '-contrast-val');
  var sv = document.getElementById('c' + cam + '-saturate-val');
  var hv = document.getElementById('c' + cam + '-hue-val');
  if (bv) bv.textContent = br + '%';
  if (cv) cv.textContent = co + '%';
  if (sv) sv.textContent = sa + '%';
  if (hv) hv.textContent = hu + '°';
}

// Přijímej filtr sync z BroadcastChannel
if (overlayBC) {
  overlayBC.onmessage = function(e) {
    if (e.data && e.data.cam != null && e.data.settings) {
      applyRemoteFilter(e.data.cam, e.data.settings);
    }
  };
}

function resetCam(n) {
  document.getElementById('c' + n + '-brightness').value = 100;
  document.getElementById('c' + n + '-contrast').value   = 100;
  document.getElementById('c' + n + '-saturate').value   = 100;
  document.getElementById('c' + n + '-hue').value        = 0;
  document.getElementById('c' + n + '-mirror').checked   = true;
  updateFilter(n);
}

// Inicializuj výchozí filtry
document.addEventListener('DOMContentLoaded', function () {
  updateFilter(1, false);
  updateFilter(2, false);
});

// ── SWAP CAMS ────────────────────────────────────────────────
function swapCams() {
  var v1 = document.getElementById('cam-video-1');
  var v2 = document.getElementById('cam-video-2');
  var src1 = v1.srcObject;
  var src2 = v2.srcObject;
  var act1 = v1.classList.contains('active');
  var act2 = v2.classList.contains('active');

  v1.srcObject = src2;
  v2.srcObject = src1;
  v1.classList.toggle('active', act2);
  v2.classList.toggle('active', act1);

  var ph1 = document.getElementById('placeholder-1');
  var ph2 = document.getElementById('placeholder-2');
  var ph1vis = ph1 ? ph1.style.display : '';
  if (ph1) ph1.style.display = ph2 ? ph2.style.display : '';
  if (ph2) ph2.style.display = ph1vis;

  if (typeof peerOrder !== 'undefined' && peerOrder.length === 2) {
    var tmp = peerOrder[0]; peerOrder[0] = peerOrder[1]; peerOrder[1] = tmp;
  }
}

// ── PEERJS VIEWER ────────────────────────────────────────────
if (!ROOM_ID) {
  console.warn('Overlay: žádný ?room= parametr – streamy se nezobrazí.');
} else {
  var myPeer    = null;
  var myId      = null;
  var ovPeers   = new Map();   // peerId -> { mediaConn, dataConn }
  var pendingConns = new Set(); // peerId's with pending connections
  var peerOrder = [];
  var slots     = [1, 2];

  function getSlot(peerId) {
    var idx = peerOrder.indexOf(peerId);
    return idx === -1 ? null : slots[idx];
  }

  function assignStream(peerId, stream) {
    console.log('[overlay] assignStream called for', peerId, 'tracks:', stream.getTracks().length);
    if (!peerOrder.includes(peerId)) {
      if (peerOrder.length < slots.length) peerOrder.push(peerId);
      else { console.warn('[overlay] No free slot for', peerId); return; }
    }
    var slot = getSlot(peerId);
    if (!slot) return;
    var vid = document.getElementById('cam-video-' + slot);
    var ph  = document.getElementById('placeholder-' + slot);
    vid.srcObject = stream;
    vid.classList.add('active');
    if (ph) ph.style.display = 'none';
    // Explicitní play pro jistotu
    vid.play().catch(function(e) { console.warn('[overlay] Play error cam', slot, e); });
    console.log('[overlay] Stream assigned to slot', slot);
  }

  function freeSlot(peerId) {
    var slot = getSlot(peerId);
    var idx  = peerOrder.indexOf(peerId);
    if (idx !== -1) peerOrder.splice(idx, 1);
    if (!slot) return;
    var vid = document.getElementById('cam-video-' + slot);
    var ph  = document.getElementById('placeholder-' + slot);
    vid.srcObject = null;
    vid.classList.remove('active');
    if (ph) ph.style.display = '';
  }

  // Broadcast data z overlay do room peers
  function broadcastDataOverlay(msg) {
    ovPeers.forEach(function(entry, id) {
      if (entry.dataConn && entry.dataConn.open) {
        try { entry.dataConn.send(msg); } catch(e) {}
      }
    });
  }

  function getHostId() { return 'studio-' + ROOM_ID; }

  function connectOverlayPeerJS() {
    if (myPeer) {
      try { myPeer.destroy(); } catch(e) {}
      myPeer = null;
    }
    ovPeers.clear();
    pendingConns.clear();
    peerOrder = [];

    myPeer = new Peer(undefined, { debug: 1 });

    myPeer.on('open', function(id) {
      myId = id;
      console.log('[overlay] Connected as', id);
      setupOverlayListeners();
      // Počkej chvíli a pak se připoj k hostovi (ať se stihne registrovat)
      setTimeout(function() {
        connectToRoomPeer(getHostId());
      }, 500);
    });

    myPeer.on('error', function(err) {
      console.error('[overlay] PeerJS error:', err.type, err.message);
      if (err.type === 'peer-unavailable') {
        // Host ještě neexistuje nebo spadl — zkus znovu za 3s
        console.warn('[overlay] Host not found, retrying in 3s...');
        setTimeout(function() {
          connectToRoomPeer(getHostId());
        }, 3000);
      } else if (err.type === 'disconnected' || err.type === 'network' || err.type === 'server-error') {
        console.warn('[overlay] Connection lost, full reconnect in 3s...');
        setTimeout(connectOverlayPeerJS, 3000);
      }
    });

    myPeer.on('disconnected', function() {
      console.warn('[overlay] Disconnected from signaling, reconnecting...');
      if (myPeer && !myPeer.destroyed) {
        myPeer.reconnect();
      }
    });
  }

  function setupOverlayListeners() {
    // Příchozí data connection (od room peerů)
    myPeer.on('connection', function(conn) {
      setupOverlayDataConn(conn);
    });

    // Příchozí media call (room peer nám posílá svůj stream)
    myPeer.on('call', function(call) {
      call.answer(); // odpovíme bez streamu (receive only)
      setupOverlayMediaConn(call);
    });
  }

  function connectToRoomPeer(peerId) {
    if (ovPeers.has(peerId) || pendingConns.has(peerId) || peerId === myId) return;
    pendingConns.add(peerId);
    console.log('[overlay] Connecting data to room peer:', peerId);

    // Data connection
    var dataConn = myPeer.connect(peerId, { reliable: true, metadata: { name: '__overlay__' } });
    setupOverlayDataConn(dataConn);

    // Nepotřebujeme call (nemáme stream) — room peer nám zavolá
  }

  function setupOverlayDataConn(conn) {
    var peerId = conn.peer;

    conn.on('open', function() {
      console.log('[overlay] Data conn OPEN with', peerId);
      pendingConns.delete(peerId);
      var entry = ovPeers.get(peerId) || {};
      entry.dataConn = conn;
      ovPeers.set(peerId, entry);
    });

    conn.on('data', function(data) {
      console.log('[overlay] Data from', peerId, ':', data.type || data);
      handleOverlayData(peerId, data);
    });

    conn.on('close', function() {
      console.log('[overlay] Data conn CLOSED with', peerId);
      pendingConns.delete(peerId);
      freeSlot(peerId);
      ovPeers.delete(peerId);
    });

    conn.on('error', function(err) {
      console.error('[overlay] Data conn error with', peerId, err);
      pendingConns.delete(peerId);
    });
  }

  function setupOverlayMediaConn(call) {
    var peerId = call.peer;
    console.log('[overlay] Media call setup from', peerId);

    call.on('stream', function(remoteStream) {
      console.log('[overlay] GOT STREAM from', peerId, 'tracks:', remoteStream.getTracks().length);
      assignStream(peerId, remoteStream);
    });

    call.on('close', function() {
      console.log('[overlay] Media call CLOSED from', peerId);
      freeSlot(peerId);
    });

    call.on('error', function(err) {
      console.error('[overlay] Media call error from', peerId, err);
    });

    var entry = ovPeers.get(peerId) || {};
    entry.mediaConn = call;
    ovPeers.set(peerId, entry);
  }

  function handleOverlayData(fromId, data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'peers':
        // Host dal seznam peerů v roomce — připoj se ke každému
        for (var i = 0; i < data.peers.length; i++) {
          var p = data.peers[i];
          if (!ovPeers.has(p.id) && p.id !== myId) {
            connectToRoomPeer(p.id);
          }
        }
        break;

      case 'peer-joined':
        // Nový peer v roomce — připoj se k němu
        if (data.id && !ovPeers.has(data.id) && data.id !== myId) {
          connectToRoomPeer(data.id);
        }
        break;

      case 'peer-left':
        freeSlot(data.id);
        var entry = ovPeers.get(data.id);
        if (entry) {
          if (entry.mediaConn) try { entry.mediaConn.close(); } catch(e) {}
          if (entry.dataConn) try { entry.dataConn.close(); } catch(e) {}
          ovPeers.delete(data.id);
        }
        break;

      case 'overlay-sync':
        applyRemoteFilter(data.cam, data.settings);
        break;
    }
  }

  // Start
  connectOverlayPeerJS();
}
