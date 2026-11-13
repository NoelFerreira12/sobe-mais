// ID anónimo: UUID aleatório guardado em cookie + localStorage. Mais nada.
const CHAVE = 'sobe_id';
const CAMINHO = new URL('../../', import.meta.url).pathname; // ex.: /sobe-mais/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function lerCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CHAVE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function guardar(id) {
  try { localStorage.setItem(CHAVE, id); } catch { /* modo privado */ }
  const seguro = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CHAVE}=${id}; Max-Age=${60 * 60 * 24 * 400}; Path=${CAMINHO}; SameSite=Lax${seguro}`;
}

export function lerId() {
  let id = null;
  try { id = localStorage.getItem(CHAVE); } catch { /* */ }
  if (!UUID_RE.test(id || '')) id = lerCookie();
  if (!UUID_RE.test(id || '')) return null;
  guardar(id); // repõe o que faltar (cookie ou localStorage)
  return id;
}

export function criarId() {
  let id;
  if (crypto.randomUUID) id = crypto.randomUUID();
  else {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  guardar(id);
  return id;
}

export function esquecerId() {
  try { localStorage.removeItem(CHAVE); localStorage.removeItem('sobe_medalhas'); } catch { /* */ }
  document.cookie = `${CHAVE}=; Max-Age=0; Path=${CAMINHO}`;
}
