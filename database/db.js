'use strict';

const config = require('../config');

// O aviso "experimental" do SQLite embutido do Node e esperado; escondemos so ele.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning && warning.message;
  if (text && String(text).includes('SQLite')) return;
  return originalEmitWarning.call(process, warning, ...rest);
};

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('\nO BotNexus precisa do Node.js 22.13 ou mais novo (SQLite embutido).');
  console.error('Versao atual: ' + process.version + '. Atualize com: pkg upgrade nodejs\n');
  process.exit(1);
}

const database = new DatabaseSync(config.dbFile);
database.exec('PRAGMA journal_mode = WAL;');
database.exec('PRAGMA foreign_keys = ON;');
database.exec('PRAGMA busy_timeout = 5000;');

const SCHEMA_VERSION = 1;

const SCHEMA_V1 = [
  'CREATE TABLE IF NOT EXISTS users (' +
    ' id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    ' name TEXT NOT NULL,' +
    ' email TEXT NOT NULL UNIQUE,' +
    ' password_hash TEXT NOT NULL,' +
    " plan TEXT NOT NULL DEFAULT 'free'," +
    ' created_at INTEGER NOT NULL' +
    ');',

  'CREATE TABLE IF NOT EXISTS sessions (' +
    ' id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    ' user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,' +
    ' token_hash TEXT NOT NULL UNIQUE,' +
    ' expires_at INTEGER NOT NULL,' +
    ' created_at INTEGER NOT NULL,' +
    ' user_agent TEXT' +
    ');',

  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);',

  'CREATE TABLE IF NOT EXISTS bots (' +
    ' id INTEGER PRIMARY KEY AUTOINCREMENT,' +
    ' user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,' +
    ' name TEXT NOT NULL,' +
    " status TEXT NOT NULL DEFAULT 'stopped'," +
    " entry_file TEXT NOT NULL DEFAULT 'index.js'," +
    ' token_enc TEXT,' +
    ' env_enc TEXT,' +
    ' auto_restart INTEGER NOT NULL DEFAULT 0,' +
    ' has_project INTEGER NOT NULL DEFAULT 0,' +
    ' last_started_at INTEGER,' +
    ' created_at INTEGER NOT NULL,' +
    ' updated_at INTEGER NOT NULL' +
    ');',

  'CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);'
];

function migrate() {
  const current = database.prepare('PRAGMA user_version').get().user_version;
  if (current < 1) {
    database.exec('BEGIN');
    try {
      for (const sql of SCHEMA_V1) database.exec(sql);
      database.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }
}

migrate();

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = database.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// Todas as consultas usam parametros (?) - nunca concatene dados do usuario no SQL.
function run(sql, params) {
  return stmt(sql).run(...(params || []));
}

function get(sql, params) {
  return stmt(sql).get(...(params || []));
}

function all(sql, params) {
  return stmt(sql).all(...(params || []));
}

function transaction(fn) {
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

function close() {
  try {
    database.close();
  } catch (e) {
    /* ignora */
  }
}

module.exports = { run, get, all, transaction, close };
