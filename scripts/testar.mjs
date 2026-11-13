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
const nomes = [];
const PW_TESTE = 'teste-123456';
/** Cria uma conta de teste e devolve o user_id. */
async function novoId() {
  const nome = `t_${randomUUID().slice(0, 8)}`;
  const r = await rpc('criar_conta', { p_utilizador: nome, p_password: PW_TESTE });
  if (!r.ok) throw new Error(`criar_conta falhou: ${JSON.stringify(r)}`);
  ids.push(r.user_id); nomes.push(nome);
  return r.user_id;
}
const scan = (id, piso) => rpc('registar_scan', { p_user_id: id, p_token: tok[piso] });
const respostas = []; // todas as respostas, para verificar a separação A/B
const resultados = [];
let falhas = 0;

function verificar(nome, cond, detalhe = '') {
  resultados.push({ nome, ok: !!cond, detalhe });
  if (!cond) falhas++;
}

/** Sequência de scans: [[piso, esperaAntesEmSeg], ...] — devolve as respostas. */
const convidados = [];
async function sequencia(passos, { semConta = false } = {}) {
  const id = semConta ? randomUUID() : await novoId();
  if (semConta) convidados.push(id);
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
  const [a, b, c, d, e, f, g, h, i, extra, conv] = await Promise.all([
    sequencia([[-3, 0], [-2, 15]]),
    sequencia([[-3, 0], [-2, 8]]),
    sequencia([[-3, 0], [0, 45]]),
    sequencia([[-3, 0], [3, 50]]),
    sequencia([[0, 0], [1, 200]]),
    sequencia([[2, 0], [1, 5]]),
    sequencia([[-3, 0], [-2, 15], [-1, 15]]),
    sequencia([[-1, 0], [-1, 3]]),
    novoId().then((id) => rpc('registar_scan', { p_user_id: id, p_token: 'piso-3' })),
    // IDs extra para garantir que há participantes A e B com subidas válidas
    Promise.all(Array.from({ length: 6 }, () => sequencia([[-1, 0], [0, 13]]))),
    // Sem conta: a subida conta para o total coletivo, sem entrar no teste A/B
    sequencia([[-3, 0], [-2, 15]], { semConta: true }),
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

  // ---------- Sem conta ----------
  const cv = conv.out[1];
  verificar('Sem conta: subida válida', cv.resultado === 'valida' && cv.conta === false, cv.resultado);
  verificar('Sem conta: vê o progresso coletivo (como a versão A)', cv.convidado === true && !!cv.coletivo && !cv.pessoal);
  const varConv = JSON.parse(sql(`select variante from public.participantes where user_id = ${lit(conv.id)};`)).rows[0]?.variante;
  verificar('Sem conta: fica fora do teste A/B (variante G)', varConv === 'G', varConv);
  const col = await rpc('progresso_coletivo');
  verificar('Sem conta: a subida entra no total coletivo', (col.lancos?.['-3'] ?? 0) >= 1, JSON.stringify(col.lancos));

  // Quem usou sem conta e depois cria conta neste telemóvel fica marcado (já viu o coletivo)
  const nomeEx = `t_${randomUUID().slice(0, 8)}`;
  const contaEx = await rpc('criar_conta', { p_utilizador: nomeEx, p_password: PW_TESTE, p_convidado: conv.id });
  ids.push(contaEx.user_id); nomes.push(nomeEx);
  const marcas = JSON.parse(sql(`select utilizador, ex_convidado from public.contas where user_id in (${lit(contaEx.user_id)}, ${lit(ids[0])});`)).rows;
  verificar('Conta criada depois de usar sem conta fica marcada (ex_convidado)',
    marcas.find((m) => m.utilizador === nomeEx)?.ex_convidado === true && marcas.find((m) => m.utilizador !== nomeEx)?.ex_convidado === false);

  // ---------- Equilíbrio A/B ----------
  const contagem = JSON.parse(sql(`select variante, count(*)::int as n from public.participantes
    where user_id in (${ids.map(lit).join(',')}) and variante in ('A','B') group by 1;`)).rows;
  const nA = contagem.find((x) => x.variante === 'A')?.n ?? 0, nB = contagem.find((x) => x.variante === 'B')?.n ?? 0;
  verificar('Contas de teste repartidas de forma equilibrada entre A e B', Math.abs(nA - nB) <= 2, `A=${nA}, B=${nB}`);

  // ---------- Contas / login / recuperação ----------
  const nomeRec = `t_${randomUUID().slice(0, 8)}`;
  const contaRec = await rpc('criar_conta', { p_utilizador: nomeRec, p_password: 'antiga123' });
  ids.push(contaRec.user_id); nomes.push(nomeRec);
  verificar('Criar conta devolve código de recuperação', /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(contaRec.codigo_recuperacao || ''), contaRec.codigo_recuperacao);
  const recMau = await rpc('recuperar_conta', { p_utilizador: nomeRec, p_codigo: 'AAAA-BBBB-CCCC', p_nova_password: 'nova1234' });
  verificar('Recuperar com código errado é recusado', recMau.ok === false && recMau.erro === 'codigo_errado');
  const codigoSolto = contaRec.codigo_recuperacao.toLowerCase().replace(/-/g, ' ');
  const recOk = await rpc('recuperar_conta', { p_utilizador: nomeRec, p_codigo: codigoSolto, p_nova_password: 'nova1234' });
  verificar('Recuperar com o código certo (minúsculas, sem hífens) funciona', recOk.ok && recOk.user_id === contaRec.user_id && recOk.codigo_recuperacao !== contaRec.codigo_recuperacao);
  verificar('Depois de recuperar, entra com a palavra-passe nova', (await rpc('entrar', { p_utilizador: nomeRec, p_password: 'nova1234' })).ok === true);
  verificar('Depois de recuperar, a palavra-passe antiga deixa de valer', (await rpc('entrar', { p_utilizador: nomeRec, p_password: 'antiga123' })).ok === false);
  const recVelho = await rpc('recuperar_conta', { p_utilizador: nomeRec, p_codigo: contaRec.codigo_recuperacao, p_nova_password: 'outra123' });
  verificar('O código de recuperação antigo deixa de valer', recVelho.ok === false);
  // Quem esquece a alcunha: o código da SUA conta não muda a palavra-passe de outra conta…
  const alheio = await rpc('recuperar_conta', { p_utilizador: nomes[0], p_codigo: recOk.codigo_recuperacao, p_nova_password: 'roubada1' });
  verificar('O meu código não muda a palavra-passe de outra conta', alheio.ok === false);
  verificar('A outra conta continua a entrar normalmente', (await rpc('entrar', { p_utilizador: nomes[0], p_password: PW_TESTE })).ok === true);
  // …e só com o código recupera a própria conta e descobre a alcunha.
  const soCodigo = await rpc('recuperar_conta', { p_utilizador: '', p_codigo: recOk.codigo_recuperacao, p_nova_password: 'nova5678' });
  verificar('Recuperar só com o código (sem alcunha) devolve a alcunha certa', soCodigo.ok && soCodigo.utilizador === nomeRec, soCodigo.utilizador);
  const novoCod = await rpc('novo_codigo_recuperacao', { p_user_id: contaRec.user_id });
  verificar('Com sessão, gera um código novo', novoCod.ok && /^[A-Z0-9-]{14}$/.test(novoCod.codigo_recuperacao));
  const dup = await rpc('criar_conta', { p_utilizador: nomes[0], p_password: 'outra-pass' });
  verificar('Nome de utilizador repetido é recusado', dup.ok === false && dup.erro === 'utilizador_existe', JSON.stringify(dup));
  verificar('Nome repetido: sugere 3 nomes livres', Array.isArray(dup.sugestoes) && dup.sugestoes.length === 3, JSON.stringify(dup.sugestoes));
  const maiusc = await rpc('criar_conta', { p_utilizador: nomes[0].toUpperCase(), p_password: 'outra-pass' });
  verificar('Maiúsculas contam como o mesmo nome (único)', maiusc.ok === false && maiusc.erro === 'utilizador_existe');
  const mau = await rpc('criar_conta', { p_utilizador: 'Nome Com Espaços!', p_password: 'abcdef' });
  verificar('Nome de utilizador inválido é recusado', mau.ok === false && mau.erro === 'utilizador_invalido');
  const curta = await rpc('criar_conta', { p_utilizador: `t_${randomUUID().slice(0, 8)}`, p_password: '123' });
  verificar('Palavra-passe curta é recusada', curta.ok === false && curta.erro === 'password_curta');
  const errada = await rpc('entrar', { p_utilizador: nomes[0], p_password: 'errada!!' });
  verificar('Login com palavra-passe errada é recusado', errada.ok === false && errada.erro === 'credenciais');
  const certo = await rpc('entrar', { p_utilizador: nomes[0].toUpperCase(), p_password: PW_TESTE });
  verificar('Login certo devolve o mesmo ID (noutro telemóvel)', certo.ok && certo.user_id === ids[0], JSON.stringify(certo));
  const est = await rpc('estado_utilizador', { p_user_id: ids[0] });
  verificar('estado_utilizador devolve conta e nome', est.conta === true && est.utilizador === nomes[0]);
  verificar('anon não lê a tabela contas', await (async () => {
    const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/contas?select=*`, { headers: { apikey: CONFIG.supabaseKey } });
    return !r.ok || (await r.text()).trim() === '[]';
  })());

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
    const esperado = JSON.parse(sql(`select count(distinct user_id)::int as n from public.scans where no_estudo;`)).rows[0].n;
    verificar('Painel tem uma linha por ID com leituras no estudo', nossos === esperado, `${nossos} de ${esperado} IDs, ${part} com subida`);
    verificar('Painel não expõe UUIDs', !JSON.stringify(p).match(/[0-9a-f]{8}-[0-9a-f]{4}-/i));
    verificar('Painel tem série diária', Array.isArray(p.diario) && p.diario.length >= 1, JSON.stringify(p.diario));
    verificar('Painel: linhas sem conta vêm marcadas como G (o cliente tira-as da análise A/B)',
      p.participantes.some((x) => x.variante === 'G') && p.participantes.every((x) => ['A', 'B', 'G'].includes(x.variante)));
    verificar('Painel: quem não tem conta aparece à parte', (p.convidados?.subidas ?? 0) >= 1, JSON.stringify(p.convidados));
  }
} finally {
  if (inicioOriginal) {
    sql(`update public.config set valor = ${lit(inicioOriginal)} where chave = 'estudo_inicio';`);
    console.log(`(estudo_inicio reposto = ${inicioOriginal})`);
  }
  if (ids.length) {
    const todos = [...ids, ...convidados].map(lit).join(',');
    sql(`delete from public.participantes where user_id in (${todos});
         delete from public.contas where user_id in (${ids.map(lit).join(',')});
         delete from public.login_tentativas where utilizador like 't\\_%' or utilizador in ('nome com espaços!', '*codigo*');
         delete from public.painel_tentativas;`);
    const resto = JSON.parse(sql(`select count(*)::int as n from public.scans where user_id in (${ids.map(lit).join(',')});`)).rows[0].n;
    console.log(`IDs de teste apagados (${ids.length}); scans restantes desses IDs: ${resto}`);
  }
}

for (const r of resultados) console.log(`${r.ok ? '✔' : '✘'} ${r.nome}${r.detalhe ? `  [${r.detalhe}]` : ''}`);
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`);
process.exit(falhas ? 1 : 0);
