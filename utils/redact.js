'use strict';

// Padrao de token do Discord: base64(id).timestamp.hmac
const DISCORD_TOKEN_RE = /[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6,7}\.[A-Za-z\d_-]{27,}/g;

// Cria uma funcao que troca segredos conhecidos por [oculto] em qualquer texto.
function createRedactor(secrets) {
  const list = (secrets || [])
    .filter((s) => typeof s === 'string' && s.length >= 8)
    .sort((a, b) => b.length - a.length);
  return function redact(text) {
    let out = String(text);
    for (const secret of list) {
      out = out.split(secret).join('[oculto]');
    }
    return out.replace(DISCORD_TOKEN_RE, '[oculto]');
  };
}

module.exports = { createRedactor, DISCORD_TOKEN_RE };
