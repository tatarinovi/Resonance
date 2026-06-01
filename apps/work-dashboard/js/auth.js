// ── Auth screens ─────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('wdash').style.display = 'none';
}

function showDash() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('wdash').style.display = 'flex';
}

async function doLogin() {
  const email = document.getElementById('emailInput').value.trim();
  const pass  = document.getElementById('passInput').value;
  const err   = document.getElementById('loginErr');
  const btn   = document.getElementById('loginBtn');
  err.textContent = '';
  if (!email || !pass) { err.textContent = 'Enter email and password'; return; }

  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(
      `${KANBAN}/auth/token?email=${encodeURIComponent(email)}&password=${encodeURIComponent(pass)}`,
      { method: 'POST' }
    );
    if (!res.ok) { err.textContent = 'Invalid credentials'; return; }
    const data = await res.json();
    const tok = data.token || data.access_token || (data.data && data.data.token) || null;
    if (!tok || typeof tok !== 'string') { err.textContent = 'Unexpected auth response'; return; }
    token = tok;
    localStorage.setItem('kanban_token', token);
    showDash();
    await loadAll();
  } catch (e) {
    err.textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

function doLogout() {
  localStorage.removeItem('kanban_token');
  token = null;
  projects = []; projectUsers = {}; epicsByProject = {};
  tasksByEpic = {}; allEpics = []; selectedProjects.clear();
  setGrid('<div class="wd-state-msg">Loading…</div>');
  showLogin();
}


