'use strict';

const { DISCORD_TOKEN_RE } = require('./redact');

function clean(args) {
  return args.map((a) => {
    const text = a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a);
    return String(text).replace(DISCORD_TOKEN_RE, '[oculto]');
  });
}

function stamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (...a) => console.log(stamp(), '[info]', ...clean(a)),
  warn: (...a) => console.warn(stamp(), '[aviso]', ...clean(a)),
  error: (...a) => console.error(stamp(), '[erro]', ...clean(a))
};
