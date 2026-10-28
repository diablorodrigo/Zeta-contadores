/**
 * Tema claro / oscuro.
 * Este archivo se carga en el <head> sin defer: aplica data-theme
 * antes de pintar el body para que no parpadee el tema equivocado.
 *
 * Preferencia: localStorage "zeta-theme" ("light" | "dark").
 * Si no hay elección, sigue prefers-color-scheme. Sin preferencia, oscuro.
 */
(function (root) {
  var STORAGE_KEY = 'zeta-theme';

  function resolveTheme(stored, prefersLight) {
    if (stored === 'light' || stored === 'dark') return stored;
    return prefersLight ? 'light' : 'dark';
  }

  function channel(hex, index) {
    return parseInt(hex.slice(index, index + 2), 16) / 255;
  }

  function linearize(value) {
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function luminance(hex6) {
    var r = linearize(channel(hex6, 0));
    var g = linearize(channel(hex6, 2));
    var b = linearize(channel(hex6, 4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    var lighter = Math.max(a, b);
    var darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Texto blanco o tinta oscura, el que contraste más sobre el color
   * de marca del estudio. Acepta #RGB y #RRGGBB.
   */
  function readableOn(hex) {
    var raw = String(hex || '').trim();
    var match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (!match) return '#ffffff';
    var body = match[1];
    if (body.length === 3) {
      body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
    }
    var ink = '#0f172a';
    var paper = '#ffffff';
    var bg = luminance(body);
    var onPaper = contrast(bg, luminance('ffffff'));
    var onInk = contrast(bg, luminance('0f172a'));
    return onInk > onPaper ? ink : paper;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    resolveTheme: resolveTheme,
    readableOn: readableOn
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof document === 'undefined') return;

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function systemPrefersLight() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function syncToggles(theme) {
    var light = theme === 'light';
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', light ? 'true' : 'false');
      buttons[i].setAttribute('aria-label', light ? 'Activar modo oscuro' : 'Activar modo claro');
      buttons[i].setAttribute('title', light ? 'Modo oscuro' : 'Modo claro');
    }
  }

  function applyTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    syncToggles(next);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var next = current === 'light' ? 'dark' : 'light';
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (err) {}
    applyTheme(next);
  }

  root.toggleTheme = toggleTheme;
  root.zetaReadableOn = readableOn;
  root.zetaApplyTheme = applyTheme;

  applyTheme(resolveTheme(readStored(), systemPrefersLight()));

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () {
      var stored = readStored();
      if (stored === 'light' || stored === 'dark') return;
      applyTheme(resolveTheme(null, mq.matches));
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      syncToggles(document.documentElement.getAttribute('data-theme') || 'dark');
    });
  }
})(typeof window !== 'undefined' ? window : this);
