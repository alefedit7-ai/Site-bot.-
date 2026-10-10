'use strict';

const logger = require('../utils/logger');

function notFoundApi(req, res) {
  res.status(404).json({ error: 'Rota nao encontrada.', code: 'nao_encontrado' });
}

// Mostra mensagens claras para erros esperados e esconde detalhes internos nos inesperados.
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    try {
      res.end();
    } catch (e) {
      /* conexao ja fechada */
    }
    return;
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'O arquivo enviado e maior que o limite permitido.', code: 'arquivo_grande' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'O corpo do pedido nao e um JSON valido.', code: 'json_invalido' });
  }
  if (err && err.name === 'AppError') {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error('Erro inesperado em ' + req.method + ' ' + req.path + ':', err);
  res.status(500).json({ error: 'Erro interno do servidor. Tente novamente.', code: 'erro_interno' });
}

module.exports = { notFoundApi, errorHandler };
