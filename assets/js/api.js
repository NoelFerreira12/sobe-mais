import { CONFIG } from '../../config.js?v=202611241451';

/** Chama uma função RPC do Supabase. Toda a validação acontece no servidor. */
export async function rpc(nome, params = {}, { timeoutMs = 15000 } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: CONFIG.supabaseKey };
  // Chaves antigas (JWT) também vão no Authorization; as "publishable" não.
  if (CONFIG.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${CONFIG.supabaseKey}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${nome}`, {
      method: 'POST', headers, body: JSON.stringify(params), signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}
