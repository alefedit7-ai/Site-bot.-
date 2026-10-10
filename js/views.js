(function () {
  'use strict';
  var BN = (window.BN = window.BN || {});
  var h = BN.h;
  BN.views = {};

  function loading() {
    return h('div', { class: 'muted', text: 'Carregando...' });
  }

  function errorBox(message) {
    return h('div', { class: 'form-error', role: 'alert', text: message });
  }

  function metaText(bot) {
    if (bot.status === 'running' || bot.status === 'starting') {
      return 'Ligado ha ' + BN.fmtUptime(bot.uptimeSeconds) + ' - ' + Math.round(bot.memoryMb) + ' MB - CPU ' + Math.round(bot.cpuPercent) + '%';
    }
    if (bot.status === 'installing') return 'Instalando dependencias...';
    if (!bot.hasProject) return 'Aguardando o envio do ZIP (aba Deploy)';
    if (!bot.hasToken) return 'Falta configurar o token (aba Configuracoes)';
    if (bot.status === 'crashed') return 'O bot parou com erro. Veja o console.';
    return 'Pronto para iniciar';
  }

  function runAction(button, botId, action, done) {
    var labels = { start: 'Bot iniciado.', stop: 'Bot parado.', restart: 'Bot reiniciado.' };
    button.disabled = true;
    BN.api.post('/api/bots/' + botId + '/' + action).then(
      function () {
        BN.toast(labels[action], 'ok');
        if (done) done();
      },
      function (err) {
        BN.toast(err.message, 'error');
        button.disabled = false;
      }
    );
  }
  BN.runAction = runAction;

  // Lista de bots reutilizada no Dashboard e em Meus bots.
  function botList(bots, reload) {
    var el = h('div', { class: 'bot-list' });
    var signature = '';
    var metas = {};

    function sig(list) {
      return JSON.stringify(list.map(function (b) { return [b.id, b.name, b.status, b.hasToken, b.hasProject]; }));
    }

    function build(list) {
      BN.clear(el);
      metas = {};
      list.forEach(function (bot) {
        var live = bot.status === 'running' || bot.status === 'starting';
        var busy = bot.status === 'installing' || bot.status === 'stopping';
        var meta = h('div', { class: 'bot-meta', text: metaText(bot) });
        metas[bot.id] = meta;
        var toggle = live
          ? h('button', { class: 'btn btn-small', type: 'button', onclick: function (e) { runAction(e.currentTarget, bot.id, 'stop', reload); } }, BN.icon('stop'), 'Parar')
          : h('button', { class: 'btn btn-small btn-primary', type: 'button', disabled: busy, onclick: function (e) { runAction(e.currentTarget, bot.id, 'start', reload); } }, BN.icon('play'), 'Iniciar');
        el.appendChild(
          h('div', { class: 'bot-row' },
            h('div', { class: 'stack-sm' },
              h('div', { class: 'row' }, h('a', { class: 'bot-name', href: '#/bots/' + bot.id + '/console', text: bot.name }), BN.statusPill(bot.status)),
              meta
            ),
            h('div', { class: 'row' }, h('a', { class: 'btn btn-small', href: '#/bots/' + bot.id + '/console', text: 'Abrir' }), toggle)
          )
        );
      });
    }

    function update(list) {
      var next = sig(list);
      if (next !== signature) {
        signature = next;
        build(list);
        return;
      }
      list.forEach(function (bot) {
        if (metas[bot.id]) metas[bot.id].textContent = metaText(bot);
      });
    }

    update(bots);
    return { el: el, update: update };
  }

  function emptyState(onCreate) {
    return h('div', { class: 'panel empty' },
      h('h3', { text: 'Voce ainda nao tem bots' }),
      h('p', { text: 'Crie o primeiro bot, envie o ZIP do projeto e coloque o token para ligar.' }),
      h('div', { class: 'row', style: null }, h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate }, BN.icon('plus'), 'Criar bot'))
    );
  }

  function createForm(onCreated) {
    var input = h('input', { class: 'input', type: 'text', maxlength: '40', placeholder: 'Nome do bot (ex: Meu bot de musica)', autocomplete: 'off' });
    var error = h('div');
    var button = h('button', { class: 'btn btn-primary', type: 'submit' }, BN.icon('plus'), 'Criar');
    var form = h('form', {
      class: 'panel stack-sm',
      onsubmit: function (e) {
        e.preventDefault();
        BN.clear(error);
        button.disabled = true;
        BN.api.post('/api/bots', { name: input.value }).then(
          function (data) {
            BN.toast('Bot criado. Agora envie o ZIP.', 'ok');
            onCreated(data.bot);
          },
          function (err) {
            error.appendChild(errorBox(err.message));
            button.disabled = false;
          }
        );
      }
    }, h('h3', { text: 'Novo bot' }), input, error, h('div', { class: 'row' }, button));
    return { el: form, focus: function () { input.focus(); } };
  }

  // ---------- Autenticacao ----------
  BN.views.auth = function (onLogin) {
    var mode = 'login';
    var card = h('div', { class: 'auth-card' });

    function render() {
      BN.clear(card);
      var error = h('div');
      var name = h('input', { class: 'input', type: 'text', maxlength: '40', autocomplete: 'name', required: true });
      var email = h('input', { class: 'input', type: 'email', maxlength: '254', autocomplete: 'email', required: true });
      var password = h('input', { class: 'input', type: 'password', maxlength: '128', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
      var submit = h('button', { class: 'btn btn-primary', type: 'submit', text: mode === 'login' ? 'Entrar' : 'Criar conta' });

      var form = h('form', {
        class: 'stack',
        onsubmit: function (e) {
          e.preventDefault();
          BN.clear(error);
          submit.disabled = true;
          var body = { email: email.value, password: password.value };
          if (mode === 'register') body.name = name.value;
          BN.api.post(mode === 'login' ? '/api/auth/login' : '/api/auth/register', body).then(
            function (data) { onLogin(data.user); },
            function (err) {
              error.appendChild(errorBox(err.message));
              submit.disabled = false;
            }
          );
        }
      },
        mode === 'register' ? BN.field('Seu nome', name) : null,
        BN.field('E-mail', email),
        BN.field('Senha', password, mode === 'register' ? 'Minimo de 8 caracteres, com letras e numeros.' : null),
        error,
        submit
      );

      card.appendChild(h('div', { class: 'brand' }, BN.logo(), 'BotNexus'));
      card.appendChild(
        h('div', { class: 'auth-tabs' },
          h('button', { class: 'auth-tab' + (mode === 'login' ? ' active' : ''), type: 'button', text: 'Entrar', onclick: function () { mode = 'login'; render(); } }),
          h('button', { class: 'auth-tab' + (mode === 'register' ? ' active' : ''), type: 'button', text: 'Criar conta', onclick: function () { mode = 'register'; render(); } })
        )
      );
      card.appendChild(form);
    }
    render();

    var side = h('div', { class: 'auth-side' },
      h('div', { class: 'brand' }, BN.logo(), 'BotNexus'),
      h('h1', { text: 'Seu bot do Discord no ar, sem complicacao.' }),
      h('p', { class: 'muted', text: 'Envie o ZIP, coloque o token e acompanhe tudo pelo console em tempo real.' }),
      h('div', { class: 'term-preview' },
        h('div', { text: '> Iniciando index.js...' }),
        h('div', { text: '> Conectando ao Discord...' }),
        h('div', { class: 'ok', text: '> Bot online.' })
      )
    );
    return h('div', { class: 'auth' }, side, h('div', { class: 'auth-main' }, card));
  };

  // ---------- Dashboard ----------
  BN.views.dashboard = function (ctx) {
    var page = h('div', { class: 'page' }, h('h1', { text: 'Ola, ' + BN.state.user.name }), loading());
    var list = null;
    var statBots, statRunning;

    function stat(label, value) {
      var v = h('div', { class: 'stat-value', text: value });
      return { el: h('div', { class: 'stat' }, v, h('div', { class: 'stat-label', text: label })), set: function (t) { v.textContent = t; } };
    }

    function refresh(first) {
      Promise.all([BN.api.get('/api/plan'), BN.api.get('/api/bots')]).then(
        function (res) {
          var plan = res[0];
          var bots = res[1].bots;
          var running = bots.filter(function (b) { return b.status === 'running' || b.status === 'starting'; }).length;
          if (first) {
            BN.clear(page);
            page.appendChild(h('div', { class: 'row-between' },
              h('h1', { text: 'Ola, ' + BN.state.user.name }),
              h('a', { class: 'btn btn-primary', href: '#/bots', text: 'Gerenciar bots' })
            ));
            statBots = stat('Bots criados', bots.length + ' de ' + plan.plan.maxBots);
            statRunning = stat('Ligados agora', running + ' de ' + plan.plan.maxRunningBots);
            page.appendChild(h('div', { class: 'stats' },
              statBots.el, statRunning.el,
              stat('Memoria por bot', plan.plan.memoryMb + ' MB').el,
              stat('Plano', plan.plan.label).el
            ));
            page.appendChild(h('h2', { text: 'Seus bots' }));
            if (bots.length === 0) {
              page.appendChild(emptyState(function () { location.hash = '#/bots'; }));
            } else {
              list = botList(bots, function () { refresh(false); });
              page.appendChild(list.el);
            }
          } else {
            statBots.set(bots.length + ' de ' + plan.plan.maxBots);
            statRunning.set(running + ' de ' + plan.plan.maxRunningBots);
            if (list && bots.length) list.update(bots);
            else if (!list && bots.length) refresh(true);
          }
        },
        function (err) {
          if (first) {
            BN.clear(page);
            page.appendChild(errorBox(err.message));
          }
        }
      );
    }
    refresh(true);
    var timer = setInterval(function () { refresh(false); }, 5000);
    ctx.onLeave(function () { clearInterval(timer); });
    return page;
  };

  // ---------- Meus bots ----------
  BN.views.bots = function (ctx) {
    var holder = h('div');
    var formHolder = h('div');
    var list = null;
    var page = h('div', { class: 'page' },
      h('div', { class: 'row-between' },
        h('h1', { text: 'Meus bots' }),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: showForm }, BN.icon('plus'), 'Novo bot')
      ),
      formHolder,
      holder
    );

    function showForm() {
      BN.clear(formHolder);
      var form = createForm(function (bot) { location.hash = '#/bots/' + bot.id + '/deploy'; });
      formHolder.appendChild(form.el);
      form.focus();
    }

    function refresh(first) {
      BN.api.get('/api/bots').then(
        function (data) {
          if (first) BN.clear(holder);
          if (data.bots.length === 0) {
            if (first) holder.appendChild(emptyState(showForm));
            return;
          }
          if (!list) {
            BN.clear(holder);
            list = botList(data.bots, function () { refresh(false); });
            holder.appendChild(list.el);
          } else {
            list.update(data.bots);
          }
        },
        function (err) {
          if (first) {
            BN.clear(holder);
            holder.appendChild(errorBox(err.message));
          }
        }
      );
    }
    holder.appendChild(loading());
    refresh(true);
    var timer = setInterval(function () { refresh(false); }, 5000);
    ctx.onLeave(function () { clearInterval(timer); });
    return page;
  };

  // ---------- Plano ----------
  BN.views.plan = function () {
    var page = h('div', { class: 'page' }, h('h1', { text: 'Plano e limites' }), loading());
    BN.api.get('/api/plan').then(
      function (data) {
        var p = data.plan;
        var u = data.usage;
        BN.clear(page);
        page.appendChild(h('h1', { text: 'Plano e limites' }));
        page.appendChild(h('div', { class: 'panel stack-sm' },
          h('div', { class: 'row-between' }, h('h2', { text: 'Plano ' + p.label }), h('span', { class: 'pill', text: 'Atual' })),
          h('p', { class: 'muted', text: 'Os limites abaixo valem para a sua conta. Planos com mais recursos serao adicionados no futuro.' })
        ));
        function limit(label, used, max) {
          var bar = h('span');
          var wrap = h('div', { class: 'bar' }, bar);
          bar.style.width = Math.min(100, Math.round((used / max) * 100)) + '%';
          return h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: used + ' / ' + max }), h('div', { class: 'stat-label', text: label }), wrap);
        }
        page.appendChild(h('div', { class: 'stats' },
          limit('Bots criados', u.bots, p.maxBots),
          limit('Bots ligados', u.running, p.maxRunningBots),
          h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: p.memoryMb + ' MB' }), h('div', { class: 'stat-label', text: 'Memoria por bot' })),
          h('div', { class: 'stat' }, h('div', { class: 'stat-value', text: p.diskMb + ' MB' }), h('div', { class: 'stat-label', text: 'Disco por bot' }))
        ));
        page.appendChild(h('div', { class: 'panel stack-sm' },
          h('h3', { text: 'Como seu bot e executado' }),
          h('p', { class: 'muted', text: data.isolation.description }),
          h('p', { class: 'muted small', text: 'Tamanho maximo do ZIP: ' + p.uploadMaxMb + ' MB. Se o bot passar do limite de memoria, ele e encerrado automaticamente.' })
        ));
      },
      function (err) {
        BN.clear(page);
        page.appendChild(errorBox(err.message));
      }
    );
    return page;
  };

  // ---------- Ajuda ----------
  BN.views.help = function () {
    function item(title, body) {
      return h('div', { class: 'panel help-list' }, h('h3', { text: title }), body);
    }
    return h('div', { class: 'page' },
      h('h1', { text: 'Ajuda' }),
      item('Como preparar o ZIP do bot', h('ol', null,
        h('li', { text: 'Coloque o arquivo principal (index.js) e o package.json na raiz do ZIP, ou dentro de uma unica pasta.' }),
        h('li', { text: 'Nao inclua o token no codigo. Leia o token em process.env.DISCORD_TOKEN (ou process.env.TOKEN).' }),
        h('li', { text: 'Liste suas bibliotecas (como discord.js) em dependencies no package.json. O BotNexus instala sozinho.' }),
        h('li', { text: 'Dados que precisam sobreviver a novos envios devem ficar na pasta storage/.' })
      )),
      item('Primeiros passos', h('ol', null,
        h('li', { text: 'Crie um bot em Meus bots.' }),
        h('li', { text: 'Na aba Deploy, envie o ZIP.' }),
        h('li', { text: 'Na aba Configuracoes, cole o token do seu bot (ele fica criptografado e nunca mais e exibido).' }),
        h('li', { text: 'Clique em Iniciar e acompanhe tudo na aba Console.' })
      )),
      item('Problemas comuns', h('ul', null,
        h('li', { text: 'Bot com erro logo ao iniciar: leia as ultimas linhas do console. Costuma ser token invalido ou dependencia faltando.' }),
        h('li', { text: 'Dependencias nao instaladas: use o botao Instalar dependencias na aba Deploy.' }),
        h('li', { text: 'O ZIP foi recusado: confira o tamanho, evite arquivos .exe e nao use ZIP protegido por senha.' }),
        h('li', { text: 'Bot encerrado por memoria: o plano limita a memoria de cada bot. Reduza o uso de cache.' })
      ))
    );
  };
})();
