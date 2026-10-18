const byId = id => document.getElementById(id);
let password = '';
let busy = false;
let session = 0;

async function load() {
  if (busy) return;
  busy = true;
  const currentSession = session;
  byId('error').hidden = true;
  byId('login-button').disabled = true;
  byId('refresh').disabled = true;
  try {
    const response = await fetch('/api/admin', { headers: { Authorization: `Bearer ${password}` }, cache: 'no-store' });
    const data = await response.json();
    if (currentSession !== session) return;
    if (!response.ok) {
      if (response.status === 401) {
        lock();
        byId('error').textContent = data.error || 'La contraseña no es correcta.';
        byId('error').hidden = false;
        return;
      }
      throw new Error(data.error || 'No pudimos cargar las visitas.');
    }
    byId('login-panel').hidden = true;
    byId('admin-panel').hidden = false;
    byId('logout').hidden = false;
    byId('demo-notice').hidden = data.mode !== 'demo';
    byId('total').textContent = new Intl.NumberFormat('es').format(data.total);
    byId('unique').textContent = new Intl.NumberFormat('es').format(data.unique);
    byId('records').textContent = data.visits.length;
    const rows = data.visits.map(visit => {
      const row = document.createElement('tr');
      const date = new Date(visit.at);
      for (const value of [visit.ip, date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }), date.toLocaleTimeString('es')]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    });
    byId('visits').replaceChildren(...rows);
    byId('empty').hidden = rows.length > 0;
    byId('updated').textContent = `Actualizado a las ${new Date(data.updatedAt).toLocaleTimeString('es')}`;
  } catch (error) {
    if (currentSession !== session) return;
    byId('error').textContent = error.message;
    byId('error').hidden = false;
  } finally {
    busy = false;
    byId('login-button').disabled = false;
    byId('refresh').disabled = false;
  }
}

export function lock() {
  session++;
  password = '';
  byId('password').value = '';
  byId('visits').replaceChildren();
  for (const id of ['total', 'unique', 'records', 'updated']) byId(id).textContent = '';
  byId('admin-panel').hidden = true;
  byId('logout').hidden = true;
  byId('login-panel').hidden = false;
  if (document.getElementById('owner-panel').open) byId('password').focus();
}

byId('login-form').addEventListener('submit', event => {
  event.preventDefault();
  password = byId('password').value;
  byId('password').value = '';
  load();
});
byId('refresh').addEventListener('click', load);
byId('logout').addEventListener('click', () => { lock(); byId('error').hidden = true; });

// Clear private data before it could be preserved in a browser history snapshot.
window.addEventListener('pagehide', lock);
