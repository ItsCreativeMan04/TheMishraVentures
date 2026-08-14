/**
 * Shared Theme Controller for The Mishra Ventures
 * Manages light / dark theme persistence, segmented switch states, and OS preference matching.
 */
(function () {
  function getPreferredTheme() {
    try {
      var saved = localStorage.getItem('lm-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var sw = document.getElementById('themeSwitch');
    if (!sw) return;
    var opts = sw.querySelectorAll('.ts-opt');
    opts.forEach(function (btn) {
      var active = btn.getAttribute('data-set-theme') === theme;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-on', active);
      btn.style.background = active ? '#2563eb' : 'transparent';
      btn.style.color = active
        ? '#ffffff'
        : (theme === 'light' ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.55)');
    });
  }

  function setupThemeSwitch() {
    var theme = getPreferredTheme();
    applyTheme(theme);

    var sw = document.getElementById('themeSwitch');
    if (!sw || sw.hasAttribute('data-theme-bound')) return;
    sw.setAttribute('data-theme-bound', 'true');

    sw.addEventListener('click', function (e) {
      var btn = e.target.closest('.ts-opt');
      if (!btn) return;
      var targetTheme = btn.getAttribute('data-set-theme');
      if (!targetTheme) return;
      try {
        localStorage.setItem('lm-theme', targetTheme);
      } catch (err) {}
      applyTheme(targetTheme);
    });

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
        var hasSaved = false;
        try {
          hasSaved = !!localStorage.getItem('lm-theme');
        } catch (err) {}
        if (!hasSaved) {
          applyTheme(e.matches ? 'light' : 'dark');
        }
      });
    }
  }

  window.initThemeSwitch = setupThemeSwitch;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupThemeSwitch);
  } else {
    setupThemeSwitch();
  }
})();
