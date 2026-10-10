(function () {
  'use strict';
  var BN = (window.BN = window.BN || {});
  var h = BN.h;
  var ANSI_RE = new RegExp('\\u001b\\[[0-9;?]*[A-Za-z]', 'g');
  var MAX_DOM_LINES = 500;

  function errorBox(message) {
    return h('div', { class: 'form-error', role: 'alert', text: message });
  }

  function isLive(status) {
    return status === 'running' || status === 'starting';
  }

  // ---------- aba Console ----------
  function consoleTab(botId, ctx) {
    var state = h('span', { text: 'Conectando...' });
    var body = h('div', { class: 'console', role: 'log', 'aria-live': 'off' });
    var wrap = h('div', { class: 'console-wrap' },
      h('div', { class: 'console-bar' },
        state,
        h('button', { class: 'btn btn-small btn-ghost', type: 'button', text: 'Limpar tela', onclick: function () { BN.clear(body); } })
      ),
      body
    );

    function addLine(entry) {
      var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
      var text = String(entry.m).replace(ANSI_RE, '');
      body.appendChild(h('div', { class: 'log log-' + entry.s },
        h('span', { class: 'log-time', text: BN.fmtClock(entry.t) }),
        h('span', { class: 'log-msg', text: text })
      ));
      while (body.childNodes.length > MAX_DOM_LINES) body.removeChild(body.firstChild);
      if (nearBottom) body.scrollTop = body.scrollHeight;
    }

    var source = new EventSource('/api/bots/' + botId + '/logs/stream');
    source.addEventListener('open', function () {
      state.textContent = 'Ao vivo';
      wrap.classList.add('live');
    });
    source.addEventListener('log', function (ev) {
      try { addLine(JSON.parse(ev.data)); } catch (e) { /* ignora linha invalida */ }
    });
    source.onerror = function () {
      state.textContent = 'Reconectando...';
      wrap.classList.remove('live');
    };
    ctx.onLeave(function () { source.close(); });

    return h('div', { class: 'stack-sm' }, wrap,
      h('p', { class: 'muted small', text: 'O token do bot e ocultado automaticamente se aparecer nos logs.' }));
  }

  // ---------- aba Deploy ----------
  function deployTab(getBot, plan, afterChange) {
    var bot = getBot();
    var fileInput = h('input', { class: 'input', type: 'file', accept: '.zip,application/zip,application/x-zip-compressed' });
    var barFill = h('span');
    var bar = h('div', { class: 'bar' }, barFill);
    var result = h('div', { class: 'stack-sm' });
    var sendBtn = h('button', { class: 'btn btn-primary', type: 'button' }, BN.icon('upload'), 'Enviar ZIP');
    var installBtn = h('button', { class: 'btn', type: 'button', text: 'Instalar dependencias' });

    function setBusy(busy) {
      sendBtn.disabled = busy;
      fileInput.disabled = busy;
    }

    sendBtn.addEventListener('click', function () {
      BN.clear(result);
      var file = fileInput.files && fileInput.files[0];
      if (!file) return BN.toast('Escolha um arquivo .zip primeiro.', 'error');
      if (!/\.zip$/i.test(file.name)) return BN.toast('O arquivo precisa terminar em .zip.', 'error');
      if (file.size > plan.uploadMaxMb * 1048576) {
        return BN.toast('O ZIP passa do limite de ' + plan.uploadMaxMb + ' MB do seu plano.', 'error');
      }
      setBusy(true);
      barFill.style.width = '0%';
      BN.api.upload('/api/bots/' + bot.id + '/upload', file, function (ratio) {
        barFill.style.width = Math.round(ratio * 100) + '%';
      }).then(
        function (data) {
          setBusy(false);
          barFill.style.width = '100%';
          var up = data.upload;
          result.appendChild(h('div', { class: 'panel stack-sm' },
            h('strong', { text: 'ZIP enviado com sucesso' }),
            h('span', { class: 'muted', text: up.files + ' arquivos - ' + BN.fmtBytes(up.sizeBytes) + ' - arquivo principal: ' + up.entryFile }),
            up.installStarted ? h('span', { class: 'muted', text: 'Instalando dependencias. Acompanhe na aba Console.' }) : null
          ));
          BN.toast('ZIP enviado.', 'ok');
          afterChange();
        },
        function (err) {
          setBusy(false);
          barFill.style.width = '0%';
          result.appendChild(errorBox(err.message));
        }
      );
    });

    installBtn.addEventListener('click', function () {
      installBtn.disabled = true;
      BN.api.post('/api/bots/' + bot.id + '/install').then(
        function () {
          BN.toast('Instalacao iniciada. Veja o console.', 'ok');
          afterChange();
          installBtn.disabled = false;
        },
        function (err) {
          BN.toast(err.message, 'error');
          installBtn.disabled = false;
        }
      );
    });

    var live = isLive(bot.status);
    if (live) { sendBtn.disabled = true; fileInput.disabled = true; }

    return h('div', { class: 'stack' },
      h('div', { class: 'panel stack-sm' },
        h('h2', { text: 'Enviar projeto (ZIP)' }),
        h('p', { class: 'muted', text: 'Envie um ZIP com index.js e package.json. Cada novo envio substitui os arquivos anteriores (a pasta storage/ e mantida).' }),
        live ? h('div', { class: 'form-error', text: 'Pare o bot antes de enviar um novo ZIP.' }) : null,
        fileInput,
        bar,
        h('div', { class: 'row' }, sendBtn, installBtn),
        h('p', { class: 'muted small', text: 'Limite do seu plano: ' + plan.uploadMaxMb + ' MB por ZIP.' })
      ),
      result
    );
  }

  // ---------- aba Configuracoes ----------
  function settingsTab(getBot, setBot, rerender, onDeleted) {
    var bot = getBot();

    function save(payload, successText) {
      return BN.api.patch('/api/bots/' + bot.id + '/settings', payload).then(
        function (data) {
          setBot(data.bot);
          BN.toast(data.restartRequired ? successText + ' Reinicie o bot para aplicar.' : successText, 'ok');
          rerender();
        },
        function (err) {
          BN.toast(err.message, 'error');
        }
      );
    }

    var nameInput = h('input', { class: 'input', type: 'text', maxlength: '40', value: bot.name });
    var entryInput = h('input', { class: 'input', type: 'text', maxlength: '120', value: bot.entryFile, autocapitalize: 'off', autocomplete: 'off' });
    var autoInput = h('input', { type: 'checkbox' });
    autoInput.checked = bot.autoRestart;

    var general = h('form', {
      class: 'panel stack',
      onsubmit: function (e) {
        e.preventDefault();
        save({ name: nameInput.value, entryFile: entryInput.value, autoRestart: autoInput.checked }, 'Configuracoes salvas.');
      }
    },
      h('h2', { text: 'Geral' }),
      BN.field('Nome do bot', nameInput),
      BN.field('Arquivo principal', entryInput, 'Exemplo: index.js ou src/bot.js. Roda sempre com Node.js.'),
      h('label', { class: 'check' }, autoInput,
        h('span', null, h('strong', { text: 'Reiniciar automaticamente se travar' }), h('br'), h('span', { class: 'muted small', text: 'Ate 5 tentativas em 10 minutos.' }))),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit', text: 'Salvar' }))
    );

    var tokenInput = h('input', { class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', placeholder: bot.hasToken ? 'Token salvo (oculto). Cole outro para trocar.' : 'Cole o token do bot aqui' });
    var tokenForm = h('form', {
      class: 'panel stack',
      onsubmit: function (e) {
        e.preventDefault();
        if (!tokenInput.value.trim()) return BN.toast('Cole o token antes de salvar.', 'error');
        save({ token: tokenInput.value }, 'Token salvo.');
      }
    },
      h('h2', { text: 'Token do bot' }),
      BN.field('Token', tokenInput, 'O token e criptografado no servidor e nunca volta para o navegador.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'submit', text: 'Salvar token' }),
        bot.hasToken ? h('button', { class: 'btn btn-danger', type: 'button', text: 'Remover token', onclick: function () {
          if (window.confirm('Remover o token salvo deste bot?')) save({ clearToken: true }, 'Token removido.');
        } }) : null
      )
    );

    var keyInput = h('input', { class: 'input', type: 'text', maxlength: '64', placeholder: 'NOME_DA_VARIAVEL', autocapitalize: 'characters', autocomplete: 'off' });
    var valInput = h('input', { class: 'input', type: 'password', maxlength: '1000', placeholder: 'Valor', autocomplete: 'off' });
    var envList = h('div', { class: 'stack-sm' });
    if (bot.envKeys.length === 0) envList.appendChild(h('p', { class: 'muted small', text: 'Nenhuma variavel definida.' }));
    bot.envKeys.forEach(function (key) {
      envList.appendChild(h('div', { class: 'env-item' },
        h('span', { text: key + ' = ********' }),
        h('button', { class: 'btn btn-small btn-danger', type: 'button', text: 'Remover', onclick: function () { save({ envRemove: [key] }, 'Variavel removida.'); } })
      ));
    });
    var envForm = h('form', {
      class: 'panel stack',
      onsubmit: function (e) {
        e.preventDefault();
        var payload = {};
        payload[keyInput.value.trim()] = valInput.value;
        save({ envSet: payload }, 'Variavel salva.');
      }
    },
      h('h2', { text: 'Variaveis de ambiente' }),
      h('p', { class: 'muted small', text: 'Disponiveis no bot em process.env. Os valores ficam ocultos depois de salvos.' }),
      envList,
      BN.field('Nome', keyInput),
      BN.field('Valor', valInput),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', text: 'Adicionar variavel' }))
    );

    var danger = h('div', { class: 'panel stack-sm' },
      h('h2', { text: 'Excluir bot' }),
      h('p', { class: 'muted', text: 'Apaga o bot, os arquivos enviados e as configuracoes. Esta acao nao pode ser desfeita.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-danger', type: 'button', onclick: function () {
        if (!window.confirm('Excluir o bot "' + bot.name + '" de vez?')) return;
        BN.api.del('/api/bots/' + bot.id).then(
          function () { BN.toast('Bot excluido.', 'ok'); onDeleted(); },
          function (err) { BN.toast(err.message, 'error'); }
        );
      } }, BN.icon('trash'), 'Excluir bot'))
    );

    return h('div', { class: 'stack' }, general, tokenForm, envForm, danger);
  }

  // ---------- pagina do bot ----------
  BN.views.botDetail = function (ctx) {
    var botId = ctx.params.id;
    var tab = ['console', 'deploy', 'settings'].indexOf(ctx.params.tab) >= 0 ? ctx.params.tab : 'console';
    var page = h('div', { class: 'page' }, h('div', { class: 'muted', text: 'Carregando...' }));
    var bot = null;
    var plan = null;
    var timer = null;

    var pillBox = h('span');
    var statUptime = h('div', { class: 'stat-value' });
    var statMem = h('div', { class: 'stat-value' });
    var statCpu = h('div', { class: 'stat-value' });
    var statEntry = h('div', { class: 'stat-value' });
    var memBar = h('span');
    var btnStart = h('button', { class: 'btn btn-primary', type: 'button' }, BN.icon('play'), 'Iniciar');
    var btnStop = h('button', { class: 'btn', type: 'button' }, BN.icon('stop'), 'Parar');
    var btnRestart = h('button', { class: 'btn', type: 'button' }, BN.icon('restart'), 'Reiniciar');
    var title = h('h1');
    var tabHolder = h('div');

    function apply(next) {
      bot = next;
      var live = isLive(bot.status);
      var transitional = bot.status === 'installing' || bot.status === 'stopping';
      title.textContent = bot.name;
      BN.clear(pillBox);
      pillBox.appendChild(BN.statusPill(bot.status));
      statUptime.textContent = bot.status === 'running' ? BN.fmtUptime(bot.uptimeSeconds) : '-';
      statMem.textContent = live ? Math.round(bot.memoryMb) + ' MB' : '-';
      statCpu.textContent = live ? Math.round(bot.cpuPercent) + '%' : '-';
      statEntry.textContent = bot.entryFile;
      if (plan) memBar.style.width = live ? Math.min(100, Math.round((bot.memoryMb / plan.memoryMb) * 100)) + '%' : '0%';
      btnStart.disabled = live || transitional;
      btnStop.disabled = !live;
      btnRestart.disabled = !live;
    }

    function poll() {
      BN.api.get('/api/bots/' + botId).then(
        function (data) { apply(data.bot); },
        function (err) { if (err.status === 404) location.hash = '#/bots'; }
      );
    }

    btnStart.addEventListener('click', function () { runAction(btnStart, botId, 'start', poll); });
    btnStop.addEventListener('click', function () { runAction(btnStop, botId, 'stop', poll); });
    btnRestart.addEventListener('click', function () { runAction(btnRestart, botId, 'restart', poll); });
    function runAction(button, id, action, done) { BN.runAction(button, id, action, done); }

    function renderTab() {
      BN.clear(tabHolder);
      if (tab === 'console') tabHolder.appendChild(consoleTab(botId, ctx));
      else if (tab === 'deploy') tabHolder.appendChild(deployTab(function () { return bot; }, plan, poll));
      else tabHolder.appendChild(settingsTab(
        function () { return bot; },
        function (b) { apply(b); },
        renderTab,
        function () { location.hash = '#/bots'; }
      ));
    }

    Promise.all([BN.api.get('/api/bots/' + botId), BN.api.get('/api/plan')]).then(
      function (res) {
        plan = res[1].plan;
        BN.clear(page);
        function tabLink(id, label) {
          return h('a', { class: 'tab' + (tab === id ? ' active' : ''), href: '#/bots/' + botId + '/' + id, text: label });
        }
        page.appendChild(h('a', { class: 'row muted', href: '#/bots' }, BN.icon('back'), 'Meus bots'));
        page.appendChild(h('div', { class: 'row-between' }, h('div', { class: 'row' }, title, pillBox), h('div', { class: 'row' }, btnStart, btnStop, btnRestart)));
        page.appendChild(h('div', { class: 'stats' },
          h('div', { class: 'stat' }, statUptime, h('div', { class: 'stat-label', text: 'Tempo ligado' })),
          h('div', { class: 'stat' }, statMem, h('div', { class: 'stat-label', text: 'Memoria (limite ' + plan.memoryMb + ' MB)' }), h('div', { class: 'bar' }, memBar)),
          h('div', { class: 'stat' }, statCpu, h('div', { class: 'stat-label', text: 'CPU' })),
          h('div', { class: 'stat' }, statEntry, h('div', { class: 'stat-label', text: 'Arquivo principal' }))
        ));
        page.appendChild(h('div', { class: 'tabs' }, tabLink('console', 'Console'), tabLink('deploy', 'Deploy'), tabLink('settings', 'Configuracoes')));
        page.appendChild(tabHolder);
        apply(res[0].bot);
        renderTab();
        timer = setInterval(poll, 3000);
      },
      function (err) {
        BN.clear(page);
        page.appendChild(errorBox(err.status === 404 ? 'Bot nao encontrado.' : err.message));
        page.appendChild(h('a', { class: 'btn', href: '#/bots', text: 'Voltar para Meus bots' }));
      }
    );
    ctx.onLeave(function () { if (timer) clearInterval(timer); });
    return page;
  };
})();
