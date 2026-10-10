(function () {
  'use strict';
  var BN = (window.BN = window.BN || {});

  function fail(message, status, code) {
    var err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
  }

  function handleUnauthorized(path, status) {
    var isAuthCall = path.indexOf('/api/auth/login') === 0 || path.indexOf('/api/auth/register') === 0;
    if (status === 401 && !isAuthCall && typeof BN.onUnauthorized === 'function') BN.onUnauthorized();
  }

  // Todo pedido que altera dados leva o cabecalho X-Requested-With (protecao contra CSRF).
  BN.api = {
    request: function (method, path, body) {
      var options = {
        method: method,
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'BotNexus', Accept: 'application/json' }
      };
      if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      return fetch(path, options).then(
        function (res) {
          return res.text().then(function (text) {
            var data = {};
            try {
              data = text ? JSON.parse(text) : {};
            } catch (e) {
              data = {};
            }
            if (!res.ok) {
              handleUnauthorized(path, res.status);
              throw fail(data.error || 'Erro inesperado (' + res.status + ').', res.status, data.code);
            }
            return data;
          });
        },
        function () {
          throw fail('Sem conexao com o servidor. Verifique sua internet.', 0);
        }
      );
    },
    get: function (path) { return BN.api.request('GET', path); },
    post: function (path, body) { return BN.api.request('POST', path, body === undefined ? {} : body); },
    patch: function (path, body) { return BN.api.request('PATCH', path, body); },
    del: function (path) { return BN.api.request('DELETE', path); },

    // Envio do ZIP como corpo binario, com barra de progresso.
    upload: function (path, file, onProgress) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', path);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-Requested-With', 'BotNexus');
        xhr.setRequestHeader('Content-Type', 'application/zip');
        xhr.upload.onprogress = function (ev) {
          if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
        };
        xhr.onerror = function () { reject(fail('Falha de conexao durante o envio.', 0)); };
        xhr.onload = function () {
          var data = {};
          try {
            data = JSON.parse(xhr.responseText || '{}');
          } catch (e) {
            data = {};
          }
          if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
          handleUnauthorized(path, xhr.status);
          reject(fail(data.error || 'Erro no envio (' + xhr.status + ').', xhr.status, data.code));
        };
        xhr.send(file);
      });
    }
  };
})();
