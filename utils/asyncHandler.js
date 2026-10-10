'use strict';

// Express 4 nao captura erros de funcoes async sozinho. Este envelope manda o erro para o errorHandler.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
