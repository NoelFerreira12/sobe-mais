// npm run testar — testa o fluxo completo contra o Supabase real, com IDs de teste
// que são apagados no fim. Demora ~3,5 min (os tempos são reais, medidos pelo servidor).
//   --painel  também testa o painel (põe o início do estudo em "hoje" durante o teste e repõe no fim)
import { randomUUID } from 'node:crypto';
import { CONFIG, env, rpc, sql, esperar, lit } from './lib.mjs';

const comPainel = process.argv.includes('--painel');
const password = env('PAINEL_PASSWORD');
if (!password) { console.error('Falta PAINEL_PASSWORD no .env'); process.exit(1); }

const tok = {};
const r0 = await rpc('pisos_qr', { p_password: password });
if (!r0.ok) { console.error('pisos_qr falhou', r0); process.exit(1); }
for (const p of r0.pisos) tok[p.piso] = p.token;

const ids = [];
const novoId = () => { const id = randomUUID(); ids.push(id); return id; };
const scan = (id, piso) => rpc('registar_scan', { p_user_id: id, p_token: tok[piso] });
const respostas = []; // todas as respostas, para verificar a separação A/B
const resultados = [];
let falhas = 0;

function verificar(nome, cond, detalhe = '') {
  resultados.push({ nome, ok: !!cond, detalhe });
  if (!cond) falhas++;
}

/** Sequência de scans: [[piso, esperaAntesEmSeg], ...] — devolve as respostas. */
async function sequencia(passos, id = novoId()) {
  const out = [];
  for (const [piso, espera] of passos) {
    if (espera) await esperar(espera * 1000);
    const r = await scan(id, piso);
    respostas.push({ id, r });
    out.push(r);
  }
  return { id, out };
}

let inicioOriginal = null;
try {
  if (comPainel) {
    inicioOriginal = JSON.parse(sql(`select valor from public.config where chave = 'estudo_inicio';`))
      .rows?.[0]?.valor ?? CONFIG.estudo.inicio;
    sql(`update public.config set valor = (now() at time zone 'Atlantic/Madeira')::date::text where chave = 'estudo_inicio';`);
    console.log(`(estudo_inicio temporariamente = hoje; era ${inicioOriginal})`);
  }

  console.log('A correr cenários em paralelo (~3,5 min)…');
  const t0 = Date.now();
  const [a, b, c, d, e, f, g, h, i, extra] = await Promise.all([
    sequencia([[-3, 0], [-2, 15]]),
    sequencia([[-3, 0], [-2, 8]]),
    sequencia([[-3, 0], [0, 45]]),
    sequencia([[-3, 0], [3, 50]]),
    sequencia([[0, 0], [1, 200]]),
    sequencia([[2, 0], [1, 5]]),
    sequencia([[-3, 0], [-2, 15], [-1, 15]]),
    sequencia([[-1, 0], [-1, 3]]),
    rpc('registar_scan', { p_user_id: novoId(), p_token: 'piso-3' }),
    // IDs extra para garantir que há participantes A e B com subidas válidas
    Promise.all(Array.from({ length: 6 }, () => sequencia([[-1, 0], [0, 13]]))),
  ]);
  console.log(`Cenários terminados em ${Math.round((Date.now() - t0) / 1000)} s\n`);

  const ult = (s) => s.out.at(-1);
  verificar('Piso -3 → -2 em 15 s: válida', ult(a).resultado === 'valida' && ult(a).andares === 1, JSON.stringify(ult(a).segundos));
  verificar('Piso -3 → -2 em 8 s: inválida (rápido demais)', ult(b).resultado === 'rapido', ult(b).resultado);
  verificar('Piso -3 → 0 em 45 s: válida (3 andares)', ult(c).resultado === 'valida' && ult(c).andares === 3, `${ult(c).resultado}, ${ult(c).andares} andares`);
  verificar('Piso -3 → 3 em 50 s: inválida (mín. 72 s)', ult(d).resultado === 'rapido' && ult(d).min_seg === 72, `${ult(d).resultado}, min ${ult(d).min_seg}`);
  verificar('Piso 0 → 1 em 200 s: inválida (passou muito tempo)', ult(e).resultado === 'lento', ult(e).resultado);
  verificar('Piso 2 → 1: não conta (descer)', ult(f).resultado === 'descer', ult(f).resultado);
  verificar('Duas subidas em 2 min: 1.ª válida', g.out[1].resultado === 'valida', g.out[1].resultado);
  verificar('Duas subidas em 2 min: 2.ª não conta (cooldown)', g.out[2].resultado === 'cooldown', `${g.out[2].resultado}, faltam ${g.out[2].cooldown_restante_seg} s`);
  verificar('Mesmo QR 2× em 3 s: repetido', ult(h).resultado === 'repetido', ult(h).resultado);
  verificar('Token inventado ("piso-3"): rejeitado', i.ok === false && i.erro === 'qr_invalido', JSON.stringify(i));
  verificar('Primeiro scan: "inicio"', a.out[0].resultado === 'inicio', a.out[0].resultado);

  // ---------- A/B ----------
  const lista = ids.map(lit).join(',');
  const variantes = Object.fromEntries(JSON.parse(sql(`select user_id, variante from public.participantes where user_id in (${lista});`))
    .rows.map((x) => [x.user_id, x.variante]));
  const validas = respostas.filter((x) => x.r.resultado === 'valida');
  const comA = validas.filter((x) => variantes[x.id] === 'A');
  const comB = validas.filter((x) => variantes[x.id] === 'B');
  verificar('Há subidas válidas em A e em B', comA.length > 0 && comB.length > 0, `A=${comA.length}, B=${comB.length}`);
  verificar('Versão A recebe "coletivo" e não "pessoal"', comA.every((x) => x.r.coletivo && !x.r.pessoal));
  verificar('Versão B recebe "pessoal" e não "coletivo"', comB.every((x) => x.r.pessoal && !x.r.coletivo));

  const proibidas = ['coletivo', 'pessoas', 'lancos_coletivos'];
  const temChave = (o, ks) => o && typeof o === 'object' && Object.entries(o).some(([k, v]) => ks.includes(k) || temChave(v, ks));
  const respB = respostas.filter((x) => variantes[x.id] === 'B');
  verificar('Nenhuma resposta de registar_scan a B tem números coletivos', respB.every((x) => !temChave(x.r, proibidas)), `${respB.length} respostas`);
  const idsB = [...new Set(respB.map((x) => x.id))];
  const estadosB = await Promise.all(idsB.map((id) => rpc('estado_utilizador', { p_user_id: id })));
  verificar('estado_utilizador de B não tem números coletivos', estadosB.every((s) => !temChave(s, proibidas)));
  const sB = comB[0]?.r.pessoal, sA = comA[0]?.r.coletivo;
  verificar('Ecrã B: contador pessoal (subidas/andares/lanços)', sB && 'subidas' in sB && 'andares' in sB && 'lancos' in sB, JSON.stringify(sB));
  verificar('Ecrã A: progresso coletivo (subidas/pessoas/lanços)', sA && 'pessoas' in sA && 'lancos' in sA, JSON.stringify(sA));
  const mudou = JSON.parse(sql(`select count(distinct variante) as n from public.scans where user_id in (${lista}) group by user_id having count(distinct variante) > 1;`)).rows;
  verificar('A variante de cada ID nunca muda', mudou.length === 0);

  // ---------- Segurança ----------
  const proibido = async (caminho, opcoes) => {
    const headers = { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' };
    if (CONFIG.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${CONFIG.supabaseKey}`;
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${caminho}`, { headers, ...opcoes });
    const txt = await r.text();
    return !r.ok || txt.trim() === '[]';
  };
  verificar('anon não lê a tabela scans', await proibido('scans?select=*&limit=1'));
  verificar('anon não lê a tabela pisos (tokens)', await proibido('pisos?select=*'));
  verificar('anon não escreve em participantes', await proibido('participantes', { method: 'POST', body: JSON.stringify({ user_id: randomUUID(), variante: 'A' }) }));
  const pwErrada = await rpc('painel', { p_password: 'errada' });
  verificar('Painel recusa password errada', pwErrada.ok === false);
  verificar('pisos_qr recusa password errada', (await rpc('pisos_qr', { p_password: 'errada' })).ok === false);

  if (comPainel) {
    const p = await rpc('painel', { p_password: password });
    const nossos = p.participantes?.length ?? 0;
    const part = p.participantes?.filter((x) => x.subidas >= 1).length ?? 0;
    verificar('Painel abre com a password certa', p.ok === true);
    verificar('Painel conta os IDs de teste', nossos >= ids.length - 1, `${nossos} IDs, ${part} participantes`);
    verificar('Painel não expõe UUIDs', !JSON.stringify(p).match(/[0-9a-f]{8}-[0-9a-f]{4}-/i));
    verificar('Painel tem série diária', Array.isArray(p.diario) && p.diario.length >= 1, JSON.stringify(p.diario));
  }
} finally {
  if (inicioOriginal) {
    sql(`update public.config set valor = ${lit(inicioOriginal)} where chave = 'estudo_inicio';`);
    console.log(`(estudo_inicio reposto = ${inicioOriginal})`);
  }
  if (ids.length) {
    sql(`delete from public.participantes where user_id in (${ids.map(lit).join(',')});
         delete from public.painel_tentativas;`);
    const resto = JSON.parse(sql(`select count(*)::int as n from public.scans where user_id in (${ids.map(lit).join(',')});`)).rows[0].n;
    console.log(`IDs de teste apagados (${ids.length}); scans restantes desses IDs: ${resto}`);
  }
}

for (const r of resultados) console.log(`${r.ok ? '✔' : '✘'} ${r.nome}${r.detalhe ? `  [${r.detalhe}]` : ''}`);
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
