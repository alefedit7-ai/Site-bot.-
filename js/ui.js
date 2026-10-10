(function () {
  'use strict';
  var BN = (window.BN = window.BN || {});
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Cria elementos DOM com seguranca: textos entram como texto, nunca como HTML.
  BN.h = function (tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
      });
    }
    function add(child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) return child.forEach(add);
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    }
    for (var i = 2; i < arguments.length; i++) add(arguments[i]);
    return node;
  };

  var ICONS = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
    bots: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
    plan: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01',
    play: 'M7 4l13 8-13 8z',
    stop: 'M6 6h12v12H6z',
    restart: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    plus: 'M12 5v14M5 12h14',
    logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
    x: 'M6 6l12 12M18 6L6 18',
    back: 'M15 5l-7 7 7 7'
  };

  BN.icon = function (name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name] || '');
    svg.appendChild(path);
    return svg;
  };

  // Marca do BotNexus: tres nos ligados.
  BN.logo = function () {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('aria-hidden', 'true');
    function el(name, attrs) {
      var e = document.createElementNS(SVG_NS, name);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      svg.appendChild(e);
    }
    el('line', { x1: '8', y1: '24', x2: '16', y2: '7', class: 'nx-link' });
    el('line', { x1: '16', y1: '7', x2: '24', y2: '24', class: 'nx-link' });
    el('line', { x1: '8', y1: '24', x2: '24', y2: '24', class: 'nx-link' });
    el('circle', { cx: '16', cy: '7', r: '4.5', class: 'nx-a' });
    el('circle', { cx: '8', cy: '24', r: '4', class: 'nx-b' });
    el('circle', { cx: '24', cy: '24', r: '4', class: 'nx-a' });
    return svg;
  };

  BN.toast = function (message, type) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var node = BN.h('div', { class: 'toast toast-' + (type || 'ok'), role: 'status', text: message });
    box.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, type === 'error' ? 6000 : 3500);
  };

  var STATUS_LABELS = {
    stopped: 'Parado',
    starting: 'Iniciando',
    running: 'Ligado',
    stopping: 'Parando',
    crashed: 'Com erro',
    installing: 'Instalando'
  };

  BN.statusLabel = function (status) {
    return STATUS_LABELS[status] || status;
  };

  BN.statusPill = function (status) {
    return BN.h('span', { class: 'pill pill-' + status }, BN.h('span', { class: 'dot' }), BN.statusLabel(status));
  };

  BN.fmtUptime = function (seconds) {
    var s = Math.max(0, Math.floor(seconds || 0));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'min';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'min';
    var d = Math.floor(h / 24);
    return d + 'd ' + (h % 24) + 'h';
  };

  BN.fmtBytes = function (bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  BN.fmtClock = function (ms) {
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  BN.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  BN.field = function (labelText, input, hint) {
    var id = input.id || 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return BN.h('div', { class: 'field' }, BN.h('label', { for: id, text: labelText }), input, hint ? BN.h('span', { class: 'hint', text: hint }) : null);
  };
})();
