// ── Event Listeners ────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  if (e.target.id === 'detailOverlay') closeDetail();
  if (e.target.id === 'settingsOverlay') toggleSettings();
  if (e.target.id === 'workloadOverlay') toggleWorkload();
  if (e.target.id === 'taskDetailOverlay') closeTaskDetail();
  if (e.target.id === 'createTaskOverlay') closeCreateTask();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('createTaskPanel').classList.contains('open')) { closeCreateTask(); return; }
    if (document.getElementById('taskDetailPanel').classList.contains('open')) { closeTaskDetail(); return; }
    if (document.getElementById('settingsPanel').classList.contains('open')) { toggleSettings(); return; }
    if (document.getElementById('workloadPanel').classList.contains('open')) { toggleWorkload(); return; }
    if (document.getElementById('detailPanel').classList.contains('open')) { closeDetail(); return; }
  }
});

window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash.startsWith('#epic-')) {
    const id = parseInt(hash.replace('#epic-', ''));
    if (id && document.getElementById('detailPanel').dataset.epicId != id) {
      openDetail(id);
    }
  } else if (!hash || hash === '#') {
    if (document.getElementById('detailPanel').classList.contains('open')) {
      closeDetail();
    }
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
(async function init() {
  try {
    applyTheme();

    const lform = document.getElementById('loginForm');
    if (lform) {
      lform.onsubmit = (e) => {
        e.preventDefault();
        doLogin();
        return false;
      };
    }

    if (!token) {
      showLogin();
      return;
    }

    showDash();
    await loadPrefs();
    await loadAll();
    await loadTaskTemplates();

    if (window.location.hash.startsWith('#epic-')) {
      const id = parseInt(window.location.hash.replace('#epic-', ''));
      if (id) openDetail(id);
    }
  } catch (e) {
    console.error('App init error', e);
    alert('Critical init error: ' + e.message);
    showLogin();
  }
})();
