import { OBS_MODE } from './config.js';

export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function getInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

let toastTimer;
export function showToast(msg) {
  if (OBS_MODE) return;
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
