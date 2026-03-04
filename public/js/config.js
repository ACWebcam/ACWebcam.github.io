// ─── URL PARAMS ──────────────────────────────────────
const params      = new URLSearchParams(window.location.search);
export const ROOM_ID     = params.get('room') || 'default';
export const MY_NAME     = params.get('name') || localStorage.getItem('webrtc-name') || 'Anon';
export const OBS_MODE    = params.get('obs') === '1';
export const ROOM_EXPIRY = params.get('expiry') ? parseInt(params.get('expiry')) : null;

// ─── SERVER URL ─────────────────────────────────────
// When the page is served by the Node.js server (localhost or deployed render/railway/etc.)
// leave this as location.origin — it will connect to the same host automatically.
// If you somehow serve the frontend from a DIFFERENT host than the server, override here:
//   export const SERVER_URL = 'https://your-server.onrender.com';
export const SERVER_URL = location.origin;

// ─── CONSTANTS ───────────────────────────────────────
export const RES_MAP = {
  '360p':  { width: 640,  height: 360  },
  '480p':  { width: 854,  height: 480  },
  '720p':  { width: 1280, height: 720  },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k':    { width: 3840, height: 2160 }
};

// ─── SECRET / LIMITED ROOMS ──────────────────────────
// maxPeers = celč et lidí včetně hosta (overlay se nepòčítá).
// Roomky zde: nikdy nevyprší, max počet lidí je maxPeers.
// Ostatní roomky: neomezený počet lidí, časový limit jen pokud je v URL ?expiry=
export const ROOM_LIMITS = {
  'ACOBS26': { maxPeers: 4 }
};

// Roomky které NIKDY nevyprší (bez ohledu na ?expiry= param nebo localStorage)
export const PERMANENT_ROOMS = new Set(Object.keys(ROOM_LIMITS));

// ─── ICE CONFIG ──────────────────────────────────────
export const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
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
    {
      urls: [
        'turn:freeturn.net:3478',
        'turns:freeturn.net:5349'
      ],
      username: 'free',
      credential: 'free'
    },
    // Metered.ca global relay — more reliable than openrelay under load
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:443',
        'turn:global.relay.metered.ca:443?transport=tcp',
        'turns:global.relay.metered.ca:443'
      ],
      username: 'e499486ca9b61d8a7b93cfa9',
      credential: 'PGqJY+7aamlMDW2u'
    }
  ],
  iceCandidatePoolSize: 10
};

// ─── HELPERS ─────────────────────────────────────────
export function getHostId()  { return 'studio-' + ROOM_ID; }
export function getRoomLink() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'room.html?room=' + ROOM_ID;
}
export function getObsLink() {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'overlay.html?room=' + ROOM_ID + '&obs=1';
}
