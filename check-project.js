'use strict';

// Verifica o projeto sem iniciar o servidor:
//  1) todo require relativo aponta para um arquivo que existe;
//  2) todo pacote externo usado esta no package.json;
//  3) nenhum arquivo .js tem erro de sintaxe;
//  4) nenhuma crase foi usada no codigo.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies || {}));
const builtin = new Set(require('module').builtinModules);
const SKIP = new Set(['node_modules', 'data', '.git']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(root, []);
let problems = 0;
function fail(msg) {
  problems++;
  console.log('  [ERRO] ' + msg);
}

for (const file of files) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8');

  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) fail(rel + ': erro de sintaxe\n' + syntax.stderr);

  if (src.indexOf(String.fromCharCode(96)) >= 0) fail(rel + ': contem o caractere crase');

  if (rel.startsWith('public' + path.sep)) continue;
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1];
    if (target.startsWith('.')) {
      const base = path.resolve(path.dirname(file), target);
      const ok = [base, base + '.js', base + '.json', path.join(base, 'index.js')].some((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!ok) fail(rel + ': importa "' + target + '" mas o arquivo nao existe');
    } else if (target.startsWith('node:')) {
      continue;
    } else {
      const name = target;
      const top = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (!builtin.has(top) && !builtin.has(name) && !declared.has(top)) {
        fail(rel + ': usa o pacote "' + top + '" que nao esta no package.json');
      }
    }
  }
}

// Arquivos do painel referenciados no index.html
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const refRe = /(?:src|href)="(\/[^"]+)"/g;
let r;
while ((r = refRe.exec(html))) {
  if (!fs.existsSync(path.join(root, 'public', r[1]))) fail('public/index.html referencia ' + r[1] + ' que nao existe');
}

console.log(files.length + ' arquivos .js verificados.');
if (problems === 0) {
  console.log('Tudo certo: sintaxe, imports, dependencias e referencias do painel.');
} else {
  console.log(problems + ' problema(s) encontrado(s).');
  process.exit(1);
}
