(function () {
  'use strict';
  var BN = (window.BN = window.BN || {});
  var h = BN.h;
  BN.state = { user: null };

  var root = document.getElementById('app');
  var leaveHandlers = [];
  var shell = null;

  function runLeaveHandlers() {
    var list = leaveHandlers;
    leaveHandlers = [];
    list.forEach(function (fn) {
      try { fn(); } catch (e) { /* ignora */ }
    });
  }

  function parseRoute() {
    var hash = (location.hash || '#/').replace(/^#/, '');
    var parts = hash.split('/').filter(Boolean);
    if (parts.length === 0) return { name: 'dashboard', params: {} };
    if (parts[0] === 'bots' && parts.length === 1) return { name: 'bots', params: {} };
    if (parts[0] === 'bots' && /^\d+$/.test(parts[1] || '')) return { name: 'botDetail', params: { id: parts[1], tab: parts[2] || 'console' } };
    if (parts[0] === 'plano') return { name: 'plan', params: {} };
    if (parts[0] === 'ajuda') return { name: 'help', params: {} };
    return { name: 'dashboard', params: {} };
  }

  function navLink(href, icon, label, key) {
    return h('a', { href: href, 'data-nav': key }, BN.icon(icon), label);
  }

  function buildShell() {
    var sidebar = h('aside', { class: 'sidebar', id: 'sidebar' });
    var backdrop = h('div', { class: 'backdrop' });
    var main = h('main', { class: 'main', id: 'main' });

    function closeMenu() {
      sidebar.classList.remove('open');
      backdrop.classList.remove('open');
    }
    function openMenu() {
      sidebar.classList.add('open');
      backdrop.classList.add('open');
    }
    backdrop.addEventListener('click', closeMenu);

    var nav = h('nav', { class: 'nav' },
      navLink('#/', 'dashboard', 'Dashboard', 'dashboard'),
      navLink('#/bots', 'bots', 'Meus bots', 'bots'),
      navLink('#/plano', 'plan', 'Plano e limites', 'plan'),
      navLink('#/ajuda', 'help', 'Ajuda', 'help')
    );
    nav.addEventListener('click', closeMenu);

    sidebar.appendChild(h('div', { class: 'brand' }, BN.logo(), 'BotNexus'));
    sidebar.appendChild(nav);
    sidebar.appendChild(h('div', { class: 'sidebar-foot' },
      h('div', { class: 'user-box' }, h('strong', { text: BN.state.user.name }), h('span', { class: 'muted small', text: BN.state.user.email })),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: logout }, BN.icon('logout'), 'Sair')
    ));

    var topbar = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: openMenu }, BN.icon('menu')),
      h('div', { class: 'brand' }, BN.logo(), 'BotNexus')
    );

    var content = h('div', { class: 'content' }, topbar, main);
    var wrapper = h('div', { class: 'shell' }, sidebar, backdrop, content);
    return { el: wrapper, main: main, nav: nav };
  }

  function logout() {
    BN.api.post('/api/auth/logout').then(showAuth, showAuth);
  }

  function render() {
    if (!BN.state.user || !shell) return;
    runLeaveHandlers();
    var route = parseRoute();
    var activeKey = route.name === 'botDetail' ? 'bots' : route.name;
    Array.prototype.forEach.call(shell.nav.querySelectorAll('a'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === activeKey);
    });
    BN.clear(shell.main);
    var ctx = {
      params: route.params,
      onLeave: function (fn) { leaveHandlers.push(fn); }
    };
    var view = BN.views[route.name](ctx);
    shell.main.appendChild(view);
    window.scrollTo(0, 0);
  }

  function showShell() {
    BN.clear(root);
    shell = buildShell();
    root.appendChild(shell.el);
    render();
  }

  function showAuth() {
    runLeaveHandlers();
    BN.state.user = null;
    shell = null;
    BN.clear(root);
    root.appendChild(BN.views.auth(function (user) {
      BN.state.user = user;
      location.hash = '#/';
      showShell();
    }));
  }

  BN.onUnauthorized = function () {
    if (BN.state.user) {
      BN.toast('Sua sessao expirou. Entre novamente.', 'error');
      showAuth();
    }
  };

  window.addEventListener('hashchange', render);

  BN.api.get('/api/auth/me').then(
    function (data) {
      BN.state.user = data.user;
      showShell();
    },
    function () {
      showAuth();
    }
  );
})();
