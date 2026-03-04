import { ROOM_ID, ROOM_EXPIRY, PERMANENT_ROOMS } from './config.js';

let expiryInterval = null;

export function handleRoomExpiry() {
  // Permanent rooms and rooms without ?expiry= param never expire
  if (PERMANENT_ROOMS.has(ROOM_ID) || !ROOM_EXPIRY) {
    localStorage.removeItem('room-expiry-' + ROOM_ID);
    return;
  }

  const existing = localStorage.getItem('room-expiry-' + ROOM_ID);
  if (!existing) {
    localStorage.setItem('room-expiry-' + ROOM_ID, String(Date.now() + ROOM_EXPIRY * 60 * 1000));
  }
  const stored = localStorage.getItem('room-expiry-' + ROOM_ID);
  if (!stored) return;
  const ts = parseInt(stored);
  if (ts <= Date.now()) {
    alert('⏰ Platnost místnosti vypršela.');
    localStorage.removeItem('room-expiry-' + ROOM_ID);
    window.location.href = 'index.html';
    return;
  }
  startExpiryCountdown(ts);
}

export function startExpiryCountdown(expiresAt) {
  const wrap = document.getElementById('roomExpiry');
  const el   = document.getElementById('expiryCountdown');
  if (!wrap || !el) return;
  wrap.style.display = '';

  function tick() {
    const diff = expiresAt - Date.now();
    if (diff <= 0) {
      el.textContent   = 'Vypršelo';
      wrap.style.color = '#ff4444';
      clearInterval(expiryInterval);
      alert('⏰ Platnost místnosti vypršela.');
      localStorage.removeItem('room-expiry-' + ROOM_ID);
      window.location.href = 'index.html';
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000)  / 60000);
    const s = Math.floor((diff % 60000)    / 1000);
    let text = '';
    if (d > 0)        text += d + 'd ';
    if (h > 0 || d > 0) text += h + 'h ';
    text += m + 'm ' + s + 's';
    el.textContent   = text.trim();
    wrap.style.color = diff < 3600000 ? '#ff8844' : '';
  }

  tick();
  if (expiryInterval) clearInterval(expiryInterval);
  expiryInterval = setInterval(tick, 1000);
}
