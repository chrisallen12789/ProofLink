(function () {
  var mbn = document.getElementById('mobileBottomNav');
  if (!mbn) return;
  var sidebar = document.querySelector('.sidebar');

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('mobile-open');
    document.body.classList.remove('sidebar-overlay-open');
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
        if (sidebar) {
          sidebar.classList.toggle('mobile-open');
          document.body.classList.toggle('sidebar-overlay-open');
        }
        return;
      }
      var switched = true;
      if (typeof switchTab === 'function') switched = await switchTab(tab);
      if (switched !== false) syncMbn(tab);
      closeSidebar();
    });
  });

  sidebar?.querySelectorAll('.tab[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!document.body.classList.contains('sidebar-overlay-open')) return;
      window.setTimeout(closeSidebar, 0);
    });
  });

  // Keep bottom nav in sync with switchTab
  var origSwitch = window.switchTab;
  if (typeof origSwitch === 'function') {
    window.switchTab = async function (tab, opts) {
      var result = await origSwitch(tab, opts);
      if (result !== false) syncMbn(tab);
      return result;
    };
  }

  // Close sidebar overlay on outside tap
  document.addEventListener('click', function (e) {
    if (document.body.classList.contains('sidebar-overlay-open') && !e.target.closest('.sidebar') && !e.target.closest('#mbnMenuBtn')) {
      closeSidebar();
    }
  });
})();
