'use strict';

const fs = require('fs');
const { execFile } = require('child_process');

// Consumo de CPU e memoria de um processo. Usa /proc (Linux/Android) e, se nao
// existir, o comando "ps" com argumentos fixos.
const CLOCK_TICKS = 100;
const lastSamples = new Map();

function readProc(pid) {
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    const rssMatch = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = parseInt(afterName[11], 10);
    const stime = parseInt(afterName[12], 10);
    if (!rssMatch || Number.isNaN(utime) || Number.isNaN(stime)) return null;
    return { rssMb: parseInt(rssMatch[1], 10) / 1024, cpuSeconds: (utime + stime) / CLOCK_TICKS };
  } catch (e) {
    return null;
  }
}

function readPs(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'rss=,pcpu=', '-p', String(pid)], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const parts = stdout.trim().split(/\s+/);
      const rss = parseFloat(parts[0]);
      const cpu = parseFloat(parts[1]);
      if (Number.isNaN(rss)) return resolve(null);
      resolve({ rssMb: rss / 1024, cpuPercent: Number.isNaN(cpu) ? 0 : cpu });
    });
  });
}

// Retorna { memoryMb, cpuPercent } ou null se o processo nao existe mais.
async function sample(pid) {
  if (!Number.isInteger(pid) || pid < 2) return null;
  const now = Date.now();
  const proc = readProc(pid);
  if (proc) {
    const prev = lastSamples.get(pid);
    let cpuPercent = 0;
    if (prev && now > prev.at) {
      cpuPercent = ((proc.cpuSeconds - prev.cpuSeconds) / ((now - prev.at) / 1000)) * 100;
      if (cpuPercent < 0) cpuPercent = 0;
    }
    lastSamples.set(pid, { at: now, cpuSeconds: proc.cpuSeconds });
    return { memoryMb: Math.round(proc.rssMb * 10) / 10, cpuPercent: Math.round(cpuPercent * 10) / 10 };
  }
  const ps = await readPs(pid);
  if (!ps) return null;
  return { memoryMb: Math.round(ps.rssMb * 10) / 10, cpuPercent: Math.round(ps.cpuPercent * 10) / 10 };
}

function forget(pid) {
  lastSamples.delete(pid);
}

module.exports = { sample, forget };
