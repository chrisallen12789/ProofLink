(function () {
  var mbn = document.getElementById('mobileBottomNav');
  if (!mbn) return;
  var sidebar = document.querySelector('.sidebar');
  var menuButton = document.getElementById('mbnMenuBtn');

  function syncMenuButton(isOpen) {
    if (!menuButton) return;
    menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('mobile-open');
    document.body.classList.add('sidebar-overlay-open');
    syncMenuButton(true);
  }

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-overlay-open');
    syncMenuButton(false);
  }

  function syncMbn(tab) {
    mbn.querySelectorAll('.mbn-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mbnTab === tab);
    });
  }

  mbn.querySelectorAll('.mbn-item[data-mbn-tab]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var tab = btn.dataset.mbnTab;
      if (tab === '__menu') {
        if (document.body.classList.contains('sidebar-overlay-open')) closeSidebar();
        else openSidebar();
        return;
      }
      var switched = true;
      if (typeof switchTab === 'function') switched = await switchTab(tab);
      if (switched !== false) syncMbn(tab);
      closeSidebar();
    });
  });

  // Keep bottom nav in sync with switchTab
  var origSwitch = window.switchTab;
  if (typeof origSwitch === 'function') {
    window.switchTab = async function (tab, opts) {
      var result = await origSwitch(tab, opts);
      if (result !== false) syncMbn(tab);
      if (result !== false && document.body.classList.contains('sidebar-overlay-open')) closeSidebar();
      return result;
    };
  }

  // Close sidebar overlay on outside tap
  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('sidebar-overlay-open') && !e.target.closest('.sidebar') && !e.target.closest('#mbnMenuBtn')) {
      closeSidebar();
    }
  });

  syncMenuButton(document.body.classList.contains('sidebar-overlay-open'));
})();
