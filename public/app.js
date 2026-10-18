import { lock } from './admin.js';

const panel = document.getElementById('owner-panel');
let recorded = false;
let pending = false;

async function recordVisit() {
  if (recorded || pending) return;
  pending = true;
  try {
    const response = await fetch('/api/visits', { method: 'POST', cache: 'no-store', keepalive: true });
    if (!response.ok) throw new Error('counter unavailable');
    await response.json();
    recorded = true;
  } catch {
    console.warn('No se pudo registrar la visita.');
  } finally {
    pending = false;
  }
}

function syncPanel() {
  if (location.hash === '#panel') {
    if (!panel.open) panel.showModal();
  } else {
    if (panel.open) panel.close();
    recordVisit();
  }
}

panel.addEventListener('close', () => {
  lock();
  if (location.hash === '#panel') history.replaceState(null, '', location.pathname + location.search);
});
document.getElementById('close-panel').addEventListener('click', () => panel.close());
window.addEventListener('hashchange', syncPanel);
window.addEventListener('online', () => { if (location.hash !== '#panel') recordVisit(); });
syncPanel();
