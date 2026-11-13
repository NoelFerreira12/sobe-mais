// Utilitários partilhados pelos scripts Node.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';

export { CONFIG };
export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV = join(RAIZ, '.env');

/** Lê o ficheiro .env (não vai para o git) + variáveis de ambiente. */
export function env(nome) {
  if (process.env[nome]) return process.env[nome];
  if (!existsSync(ENV)) return undefined;
  for (const linha of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === nome) return m[2].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

export function definirEnv(nome, valor) {
  let txt = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  const re = new RegExp(`^${nome}=.*$`, 'm');
  txt = re.test(txt) ? txt.replace(re, `${nome}=${valor}`) : `${txt}${txt && !txt.endsWith('\n') ? '\n' : ''}${nome}=${valor}\n`;
  writeFileSync(ENV, txt);
}

export async function rpc(nome, params = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey };
  if (CONFIG.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${CONFIG.supabaseKey}`;
  const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${nome}`, { method: 'POST', headers, body: JSON.stringify(params) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${txt}`);
  return JSON.parse(txt);
}

/** Corre SQL na base de dados remota através do Supabase CLI (precisa de `supabase login` + `supabase link`). */
export function sql(consulta) {
  const dir = mkdtempSync(join(tmpdir(), 'sobe-'));
  const f = join(dir, 'q.sql');
  writeFileSync(f, consulta);
  try {
    return execFileSync('supabase', ['db', 'query', '--remote', '--yes', '-f', f, '-o', 'json'],
      { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
