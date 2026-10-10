'use strict';

// Erro com status HTTP e mensagem segura para mostrar ao usuario.
class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code || 'erro';
  }
}

const badRequest = (msg, code) => new AppError(400, msg, code || 'requisicao_invalida');
const unauthorized = (msg) => new AppError(401, msg || 'Voce precisa entrar na sua conta.', 'nao_autenticado');
const forbidden = (msg) => new AppError(403, msg || 'Acao nao permitida.', 'proibido');
const notFound = (msg) => new AppError(404, msg || 'Nao encontrado.', 'nao_encontrado');
const conflict = (msg) => new AppError(409, msg, 'conflito');
const tooMany = (msg) => new AppError(429, msg || 'Muitas tentativas. Aguarde um pouco.', 'limite_excedido');

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany };
