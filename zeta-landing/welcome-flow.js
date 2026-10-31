/* Bienvenida tras el PIN: "¿A dónde va la plata ociosa de tu cliente?".
   Lee las tasas que ya cargó simulator.js (/api/rates, caché o respaldo de config.js).
   SVG + requestAnimationFrame, sin dependencias. Respeta prefers-reduced-motion. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var EXAMPLE = 10000000;
  var state = { origin: 'fallback', date: null, raf: 0, visible: true };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function money(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }
  function pct(n) { return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }); }
  function rates() {
    var r = (typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.marketRates) || {};
    var lecap = r.lecapDetails || {};
    var list = [
      { name: 'Plazo fijo', tna: Number(r.plazoFijoTNA) },
      { name: 'Caución 30 días', tna: Number((r.caucionByDays || {})[30] || r.defaultCaucionTNA) },
      { name: 'LECAP ' + (lecap.ticker || ''), tna: Number(r.lecapTNA), vto: lecap.vencimiento }
    ];
    return list.filter(function (o) { return isFinite(o.tna) && o.tna > 0; });
  }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function render() {
    var host = document.getElementById('zf-flow');
    if (!host) return;
    cancelAnimationFrame(state.raf);
    host.innerHTML = '';
    var opts = rates();
    var narrow = host.clientWidth < 560;
    var W = narrow ? 360 : 900, H = narrow ? 530 : 380;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'zf-svg', role: 'img', 'aria-label': 'Flujo de la caja del cliente hacia plazo fijo, caución y LECAP' }, host);
    var src = narrow ? { x: 180, y: 70 } : { x: 190, y: 190 };
    if (narrow) { el('rect', { x: 90, y: 20, width: 180, height: 90, rx: 18, class: 'box' }, svg); }
    else { el('rect', { x: 20, y: 140, width: 170, height: 100, rx: 18, class: 'box' }, svg); }
    var bx = narrow ? 180 : 105, by = narrow ? 56 : 180;
    var t1 = el('text', { x: bx, y: by, 'text-anchor': 'middle', class: 'lbl' }, svg); t1.textContent = 'Caja del cliente';
    var t2 = el('text', { x: bx, y: by + 28, 'text-anchor': 'middle', class: 'val' }, svg); t2.textContent = money(EXAMPLE);
    var t3 = el('text', { x: bx, y: by + 44, 'text-anchor': 'middle', class: 'sm' }, svg); t3.textContent = 'Ejemplo';
    if (narrow) src.y = 110;
    var minT = Math.min.apply(null, opts.map(function (o) { return o.tna; }));
    var anims = [];
    opts.forEach(function (o, i) {
      var d, cx, cy;
      if (narrow) { cy = 180 + i * 120; var rx = 16 + i * 9, my = cy + 42; d = 'M180 110 C 180 150, ' + rx + ' 135, ' + rx + ' 175 L ' + rx + ' ' + (my - 14) + ' Q ' + rx + ' ' + my + ', ' + (rx + 14) + ' ' + my + ' L 60 ' + my; }
      else { cy = 70 + i * 120; cx = 640; d = 'M190 190 C 420 190, 420 ' + cy + ', 640 ' + cy; }
      var w = 6 + (o.tna - minT + 1) * 5;
      var p = el('path', { d: d, class: 'pipe', 'stroke-width': Math.min(w, narrow ? 8 : 26) }, svg);
      var cardX = narrow ? 60 : 640, cardY = narrow ? cy : cy - 42, cw = narrow ? 290 : 240;
      el('rect', { x: cardX, y: cardY, width: cw, height: 84, rx: 16, class: 'card' }, svg);
      var a = el('text', { x: cardX + 20, y: cardY + 28, class: 'lbl' }, svg); a.textContent = o.name.trim() + ' · ' + pct(o.tna) + '% TNA';
      var v = el('text', { x: cardX + 20, y: cardY + 58, class: 'val' }, svg);
      var s = el('text', { x: cardX + 20, y: cardY + 75, class: 'sm' }, svg); s.textContent = 'interés en 30 días · Ejemplo';
      var target = EXAMPLE * o.tna / 100 * 30 / 365;
      var dots = [];
      if (!reduce) for (var k = 0; k < 6; k++) dots.push(el('circle', { r: 3.5 + (o.tna - minT) * 0.8, class: 'dot' }, svg));
      anims.push({ p: p, L: p.getTotalLength(), dots: dots, v: v, target: target, sp: 0.00005 * o.tna });
      if (reduce) v.textContent = money(target);
    });
    var srcEl = document.getElementById('zf-source');
    if (srcEl) srcEl.textContent = sourceText(opts);
    if (reduce) return;
    var t0 = performance.now();
    (function loop(now) {
      var e = now - t0;
      anims.forEach(function (a) {
        a.dots.forEach(function (c, k) {
          var q = (e * a.sp + k / a.dots.length) % 1, pt = a.p.getPointAtLength(q * a.L);
          c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('opacity', Math.sin(q * Math.PI).toFixed(2));
        });
        a.v.textContent = money(a.target * Math.min(1, e / 2200));
      });
      if (state.visible) state.raf = requestAnimationFrame(loop);
    })(t0);
  }
  function sourceText(opts) {
    var when = state.date ? state.date.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires' }) + ' (Buenos Aires)' : '';
    var origin = state.origin === 'api' ? 'Tasas en vivo de /api/rates (BCRA, BYMA, Data912, ArgentinaDatos)'
      : state.origin === 'cache' ? 'Tasas de /api/rates guardadas en este equipo (BCRA, BYMA, Data912, ArgentinaDatos)'
      : 'No se pudieron traer tasas en vivo: se muestran valores de respaldo cargados en la herramienta';
    var lecap = opts.filter(function (o) { return o.vto; })[0];
    return origin + (when ? ', consultadas ' + when : '') + '. ' +
      (lecap ? 'LECAP con vencimiento ' + lecap.vto + '. ' : '') +
      'Plazo fijo: promedio BCRA a 30 días. Interés = monto × TNA × 30/365, antes de comisiones e impuestos. Montos de ejemplo. No es recomendación de inversión.';
  }
  document.addEventListener('zeta:rates', function (ev) {
    var d = ev.detail || {};
    state.origin = d.origin || 'fallback'; state.date = d.date || new Date();
    render();
  });
  var lastW = 0, tm;
  window.addEventListener('resize', function () {
    clearTimeout(tm);
    tm = setTimeout(function () { var h = document.getElementById('zf-flow'); if (h && Math.abs(h.clientWidth - lastW) > 40) { lastW = h.clientWidth; render(); } }, 150);
  });
  document.addEventListener('DOMContentLoaded', function () {
    var host = document.getElementById('zf-flow');
    if (!host) return;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        var vis = es[0].isIntersecting;
        if (vis && !state.visible) { state.visible = true; render(); } else if (!vis) { state.visible = false; }
      }).observe(host);
    }
    var b = typeof ZETA_CONFIG !== 'undefined' && ZETA_CONFIG.brand;
    if (b) {
      document.querySelectorAll('[data-brand="name"]').forEach(function (n) { n.textContent = b.name; });
      document.querySelectorAll('[data-brand="tagline"]').forEach(function (n) { n.textContent = b.tagline; });
      document.querySelectorAll('[data-brand="logo"]').forEach(function (n) { n.textContent = b.logoText; });
      if (b.logo) {
        document.querySelectorAll('[data-brand-logo]').forEach(function (n) { var src = b.logo[n.getAttribute('data-brand-logo')]; if (src) n.src = src; });
      }
      if (b.favicon) { var fav = document.querySelector('[data-brand-favicon]'); if (fav) fav.href = b.favicon; }
      if (b.accent) document.documentElement.style.setProperty('--zc-accent', b.accent);
    }
  });
  window.zetaWelcomeRender = function () { lastW = (document.getElementById('zf-flow') || {}).clientWidth || 0; render(); };
  window.zetaWelcomeSkip = function () { var t = document.getElementById('simulator-start'); if (t) t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); };
})();
