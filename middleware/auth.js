'use strict';

const sessions = require('../auth/sessions');
const { unauthorized } = require('../utils/errors');

// Le o cookie de sessao e coloca o usuario em req.user. A verificacao e sempre feita no servidor.
function requireAuth(req, res, next) {
  const cookies = sessions.parseCookies(req.headers.cookie);
  const session = sessions.findSession(cookies[sessions.COOKIE_NAME]);
  if (!session) return next(unauthorized());
  req.user = { id: session.id, name: session.name, email: session.email, plan: session.plan, createdAt: session.created_at };
  req.sessionToken = cookies[sessions.COOKIE_NAME];
  next();
}

module.exports = { requireAuth };
