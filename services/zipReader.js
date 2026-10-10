'use strict';

const zlib = require('zlib');
const { badRequest } = require('../utils/errors');

// Leitor de ZIP sem dependencias. Valida tudo ANTES de gravar qualquer arquivo.
// Suporta apenas ZIP comum (sem zip64, sem senha), metodos "store" e "deflate".

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.msi', '.scr', '.com', '.apk'];
const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 15;

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

// Limpa e valida o caminho de uma entrada. Devolve null para entradas que devem ser ignoradas.
function cleanEntryName(rawName) {
  let name = rawName.replace(/\\/g, '/');
  if (name.includes('\0')) throw badRequest('O ZIP contem um nome de arquivo invalido.');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw badRequest('O ZIP contem caminhos absolutos, o que nao e permitido.');
  }
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) {
    throw badRequest('O ZIP contem caminhos com "..", o que nao e permitido.');
  }
  if (parts.length === 0) return null;
  if (parts[0] === '__MACOSX' || parts[parts.length - 1] === '.DS_Store') return null;
  if (parts.length > MAX_DEPTH) throw badRequest('O ZIP tem pastas aninhadas demais.');
  name = parts.join('/');
  if (name.length > MAX_PATH_LENGTH) throw badRequest('O ZIP tem um nome de arquivo muito longo.');
  return name;
}

/**
 * Le a lista de entradas do ZIP e valida limites.
 * Retorna [{ name, isDir, method, compSize, size, crc, offset }]
 */
function listEntries(buf, limits) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw badRequest('O arquivo enviado nao e um ZIP valido.');
  const eocd = findEocd(buf);
  if (eocd < 0) throw badRequest('O arquivo enviado nao e um ZIP valido.');

  const diskNumber = buf.readUInt16LE(eocd + 4);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (diskNumber !== 0) throw badRequest('ZIPs divididos em varias partes nao sao suportados.');
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw badRequest('ZIPs no formato zip64 nao sao suportados. Compacte novamente com um ZIP comum.');
  }
  if (total === 0) throw badRequest('O ZIP esta vazio.');
  if (cdOffset + cdSize > buf.length) throw badRequest('O ZIP esta corrompido.');

  const entries = [];
  const seen = new Set();
  let pos = cdOffset;
  let totalSize = 0;
  let fileCount = 0;

  for (let i = 0; i < total; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw badRequest('O ZIP esta corrompido.');
    }
    const madeBy = buf.readUInt16LE(pos + 4);
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttr = buf.readUInt32LE(pos + 38);
    const offset = buf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > buf.length) throw badRequest('O ZIP esta corrompido.');
    // Sem a marca UTF-8, tenta UTF-8 mesmo assim (comum em compactadores) e so entao cai para latin1.
    let rawName = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (!(flags & 0x0800) && rawName.includes('\uFFFD')) rawName = buf.toString('latin1', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x0001) throw badRequest('ZIPs protegidos por senha nao sao suportados.');

    const isDirByName = rawName.endsWith('/') || rawName.endsWith('\\');
    const unixType = madeBy >> 8 === 3 ? (externalAttr >>> 16) & 0o170000 : 0;
    if (unixType === 0o120000) throw badRequest('O ZIP contem links simbolicos, o que nao e permitido.');
    if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000) {
      throw badRequest('O ZIP contem arquivos especiais que nao sao permitidos.');
    }

    const name = cleanEntryName(rawName);
    if (name === null) continue;

    const lower = name.toLowerCase();
    if (!isDirByName && BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      throw badRequest('O ZIP contem um tipo de arquivo bloqueado: ' + name.split('/').pop());
    }
    if (seen.has(lower)) throw badRequest('O ZIP contem arquivos duplicados: ' + name);
    seen.add(lower);

    if (!isDirByName) {
      if (method !== 0 && method !== 8) throw badRequest('Metodo de compressao nao suportado em: ' + name);
      fileCount++;
      totalSize += size;
      if (fileCount > limits.maxFiles) {
        throw badRequest('O ZIP tem arquivos demais (maximo ' + limits.maxFiles + ').');
      }
      if (totalSize > limits.maxTotalBytes) {
        throw badRequest('O conteudo do ZIP descompactado passa do limite de ' + Math.floor(limits.maxTotalBytes / 1048576) + ' MB.');
      }
    }
    entries.push({ name, isDir: isDirByName, method, compSize, size, crc, offset });
  }

  if (fileCount === 0) throw badRequest('O ZIP nao contem arquivos.');
  return entries;
}

// Descompacta uma entrada em memoria, conferindo tamanho declarado e CRC.
function readEntry(buf, entry) {
  const pos = entry.offset;
  if (pos + 30 > buf.length || buf.readUInt32LE(pos) !== SIG_LOCAL) {
    throw badRequest('O ZIP esta corrompido em: ' + entry.name);
  }
  const nameLen = buf.readUInt16LE(pos + 26);
  const extraLen = buf.readUInt16LE(pos + 28);
  const start = pos + 30 + nameLen + extraLen;
  const end = start + entry.compSize;
  if (end > buf.length) throw badRequest('O ZIP esta corrompido em: ' + entry.name);
  const raw = buf.subarray(start, end);

  let data;
  if (entry.method === 0) {
    data = Buffer.from(raw);
  } else {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
    } catch (err) {
      throw badRequest('Nao foi possivel descompactar ' + entry.name + ' (arquivo corrompido ou maior que o declarado).');
    }
  }
  if (data.length !== entry.size) throw badRequest('Tamanho inconsistente em: ' + entry.name);
  if (crc32(data) !== entry.crc) throw badRequest('Verificacao de integridade falhou em: ' + entry.name);
  return data;
}

// Se todo o conteudo estiver dentro de UMA pasta raiz, devolve o nome dela (para remover).
function detectWrapperFolder(entries) {
  const files = entries.filter((e) => !e.isDir);
  if (files.some((e) => !e.name.includes('/'))) return null;
  const roots = new Set(entries.map((e) => e.name.split('/')[0]));
  if (roots.size !== 1) return null;
  return [...roots][0];
}

module.exports = { listEntries, readEntry, detectWrapperFolder, crc32, cleanEntryName };
