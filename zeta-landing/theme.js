/* Tema claro/oscuro. Se carga en <head> para no parpadear.
   Prioridad: elección guardada (localStorage) > prefers-color-scheme. */
(function () {
  var KEY = 'zc-theme';
  var root = document.documentElement;
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function system() { return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  function apply(theme) {
    root.classList.toggle('theme-light', theme === 'light');
    root.classList.toggle('theme-dark', theme !== 'light');
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f8fafc' : '#020617');
    var btns = document.querySelectorAll('.js-theme-toggle');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btns[i].setAttribute('aria-label', theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
      btns[i].title = theme === 'light' ? 'Modo oscuro' : 'Modo claro';
      var t = btns[i].querySelector('.js-theme-label');
      if (t) t.textContent = theme === 'light' ? 'Oscuro' : 'Claro';
    }
    try { document.dispatchEvent(new CustomEvent('zeta:theme', { detail: { theme: theme } })); } catch (e) {}
  }
  function current() { return root.classList.contains('theme-light') ? 'light' : 'dark'; }
  apply(stored() || system());
  window.zetaToggleTheme = function () {
    var next = current() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  };
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (!stored()) apply(system()); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  document.addEventListener('DOMContentLoaded', function () { apply(current()); });
})();
