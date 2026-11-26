import { CONFIG } from '../../config.js?v=202611251459';
import { rpc } from './api.js?v=202611251459';
import * as ui from './ui.js?v=202611251459';
import { metros, progressoRota } from './calc.js?v=202611251459';

const ecra = document.getElementById('ecra');
document.getElementById('topo').innerHTML = ui.cabecalho('../');
const CHAVE = 'sobe_painel';
const CHAVE_TESTES = 'sobe_painel_testes';
const comTestes = () => { try { return sessionStorage.getItem(CHAVE_TESTES) === '1'; } catch { return false; } };
const CHAVE_EX = 'sobe_painel_sem_ex';
const excluirEx = () => { try { return sessionStorage.getItem(CHAVE_EX) === '1'; } catch { return false; } };

// Uma só caixa de dica para todos os gráficos.
const dica = Object.assign(document.createElement('div'), { className: 'dica', hidden: true, role: 'tooltip' });
document.body.appendChild(dica);

// ---------------------------------------------------------------------
// Estatística
// ---------------------------------------------------------------------
const soma = (a) => a.reduce((s, x) => s + x, 0);
const media = (a) => (a.length ? soma(a) / a.length : NaN);
function mediana(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function phi(z) { // função de distribuição normal padrão
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const MAX_EXATO = 80; // até aqui o teste é exato; acima, aproximação normal

/**
 * Mann–Whitney U unilateral (H1: a > b), com ordens médias nos empates.
 * Até MAX_EXATO participantes: p exato (distribuição de permutação da soma das ordens de a).
 * Acima disso: aproximação normal com correção de empates e de continuidade.
 */
function mannWhitney(a, b) {
  const n1 = a.length, n2 = b.length, N = n1 + n2;
  if (n1 < 2 || n2 < 2) return null;
  const todos = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  let empates = 0;
  for (let i = 0; i < N;) {
    let j = i;
    while (j + 1 < N && todos[j + 1].v === todos[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) todos[k].r = r;
    const t = j - i + 1; empates += t ** 3 - t; i = j + 1;
  }
  const R1 = todos.filter((x) => x.g === 0).reduce((s, x) => s + x.r, 0);
  const U = R1 - n1 * (n1 + 1) / 2;
  if (N <= MAX_EXATO) return { U, p: caudaExata(todos.map((x) => Math.round(x.r * 2)), n1, Math.round(R1 * 2)), exato: true };
  const sigma = Math.sqrt((n1 * n2 / 12) * ((N + 1) - empates / (N * (N - 1))));
  if (!sigma) return { U, p: 0.5, exato: false };
  const z = (U - n1 * n2 / 2 - 0.5) / sigma;
  return { U, p: 1 - phi(z), exato: false };
}

/**
 * P(soma de k ordens escolhidas ao acaso ≥ obs). Ordens ×2 para serem inteiras (empates = x,5).
 * formas[j][s] = n.º de formas de escolher j das ordens já vistas com soma s.
 */
function caudaExata(ordens2, k, obs) {
  const max = ordens2.reduce((s, x) => s + x, 0);
  const formas = Array.from({ length: k + 1 }, () => new Float64Array(max + 1));
  formas[0][0] = 1;
  let ate = 0;
  for (const v of ordens2) {
    ate += v;
    for (let j = k; j >= 1; j--) {
      const ant = formas[j - 1], at = formas[j];
      for (let s = ate; s >= v; s--) at[s] += ant[s - v];
    }
  }
  let total = 0, cauda = 0;
  formas[k].forEach((c, s) => { total += c; if (s >= obs) cauda += c; });
  return cauda / total;
}

/** Tamanho do efeito: correlação rank-biserial a partir do U (+1 = todos os A acima de todos os B). */
const efeito = (r, n1, n2) => (r ? (2 * r.U) / (n1 * n2) - 1 : NaN);
const teste = (a, b) => { const r = mannWhitney(a, b); return { r, ef: efeito(r, a.length, b.length) }; };

/** Fisher exato unilateral (proporção de A > proporção de B). */
function fisher(a1, n1, b1, n2) {
  if (n1 < 2 || n2 < 2) return null;
  const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const lc = (n, k) => lf(n) - lf(k) - lf(n - k);
  const N = n1 + n2, K = a1 + b1;
  let p = 0;
  for (let x = a1; x <= Math.min(n1, K); x++) p += Math.exp(lc(K, x) + lc(N - K, n1 - x) - lc(N, n1));
  return { p: Math.min(1, p) };
}

const f1 = (x, c = 1) => (Number.isFinite(x) ? ui.fmt(x, c) : '—');
const pct = (x) => (Number.isFinite(x) ? `${ui.fmt(x * 100, 0)}%` : '—');
const fp = (r) => (r ? (r.p < 0.001 ? 'p < 0,001' : `p = ${ui.fmt(r.p, 3)}`) : 'poucos dados');
const pc = (r) => (r ? (r.p < 0.001 ? '<0,001' : ui.fmt(r.p, 2)) : '—');
const efTxt = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${ui.fmt(Math.abs(x), 2)}` : '—');
const efNome = (x) => (!Number.isFinite(x) ? '' : Math.abs(x) < 0.1 ? 'nulo' : Math.abs(x) < 0.3 ? 'pequeno' : Math.abs(x) < 0.5 ? 'médio' : 'grande');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * A janela de 7 dias do H1 (do 1.º scan até 7 dias depois) está completa se já passou
 * e cabe toda no estudo. Sem isto, quem entrou há pouco (ou perto do fim) puxa o H1 para baixo.
 */
const janelaCompleta = (l, e) => somar(l.primeiro_dia, 7) < e.hoje && somar(l.primeiro_dia, 7) <= e.fim;

function grupo(linhas, v, e) {
  const ids = linhas.filter((l) => l.variante === v);
  const part = ids.filter((l) => l.subidas >= 1);
  const h1 = part.filter((l) => janelaCompleta(l, e));
  const rep7 = h1.map((l) => Math.max(0, l.subidas_7d - 1));
  const comMeta = part.filter((l) => l.meta_semanal);
  return {
    v, ids: ids.length, n: part.length, part, h1, n7: h1.length,
    taxa: part.map((l) => l.subidas / Math.max(1, l.semanas_expostas)),
    sub7: h1.map((l) => l.subidas_7d), rep7,
    dias: part.map((l) => l.dias), andares: part.map((l) => l.andares),
    subidas: soma(part.map((l) => l.subidas)),
    voltaram: part.filter((l) => l.dias >= 2).length,
    comRep: rep7.filter((x) => x >= 1).length,
    nMeta: comMeta.length,
    metaMedia: media(comMeta.map((l) => l.meta_semanal)),
    cumpriu: comMeta.filter((l) => l.por_semana.some((n) => n >= l.meta_semanal)).length,
  };
}

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function mostrarLogin(erro = '') {
  ecra.innerHTML = `
    <section class="cartao" style="max-width:440px;margin:24px auto 0">
      <h1>Painel do docente</h1>
      <p class="muted">Só leitura. Mostra apenas dados agregados e anónimos.</p>
      <form id="login" class="pilha">
        <label for="pw" class="h1">Password</label>
        <input type="password" id="pw" autocomplete="current-password" required>
        ${erro ? `<p class="aviso-caixa" role="alert" style="margin:0">${erro}</p>` : ''}
        <button class="btn" type="submit">Entrar</button>
      </form>
    </section>`;
  document.getElementById('login').addEventListener('submit', (e) => {
    e.preventDefault();
    entrar(document.getElementById('pw').value);
  });
  document.getElementById('pw').focus();
}

async function entrar(pw) {
  // Ao atualizar, o painel anterior fica visível (mais claro) em vez de saltar para "a carregar".
  const painelAtual = ecra.querySelector('.dash');
  if (painelAtual) painelAtual.classList.add('a-atualizar');
  else ecra.innerHTML = '<div class="carregar"><div class="roda"></div><span>A carregar…</span></div>';
  let r, coletivo, leituras = null;
  try {
    [r, coletivo] = await Promise.all([
      rpc('painel', { p_password: pw, p_incluir_fora: comTestes() }),
      rpc('progresso_coletivo').catch((e) => { console.error(e); return null; }),
    ]);
  } catch (e) {
    console.error(e); return mostrarLogin('Sem ligação ao servidor. Tenta outra vez.');
  }
  if (!r.ok) {
    try { sessionStorage.removeItem(CHAVE); } catch { /* */ }
    return mostrarLogin(r.erro === 'bloqueado'
      ? 'Demasiadas tentativas falhadas. Espera 15 minutos.' : 'Password incorreta.');
  }
  try { sessionStorage.setItem(CHAVE, pw); } catch { /* */ }
  // Leituras uma a uma (hora do dia, dia da semana, percursos, tempos). Só depois do login certo.
  try {
    const l = await rpc('painel_leituras', { p_password: pw, p_incluir_fora: comTestes() });
    if (l.ok) leituras = l.leituras;
  } catch (e) { console.error(e); }
  mostrarPainel({ ...r, coletivo, leituras });
}

// ---------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------
let dados = null;
const SERIES = [
  { id: 'A', nome: 'A · coletivo', cor: 'var(--serie-a)' },
  { id: 'B', nome: 'B · pessoal', cor: 'var(--serie-b)' },
];
// Toda a gente: A, B e os antigos "sem grupo" (fora da comparação A/B, mas contam no total).
const SERIES3 = [...SERIES, { id: 'G', nome: 'Sem grupo', cor: 'var(--neutro-forte)' }];
const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function mostrarPainel(d) {
  dados = d;
  const semEx = excluirEx();
  const nEx = { A: 0, B: 0 };
  d.participantes.forEach((l) => { if (l.ex_convidado && l.subidas >= 1 && nEx[l.variante] != null) nEx[l.variante]++; });
  // Comparação A/B (H1, tabela A vs B): só A e B. O resto do painel mostra toda a gente.
  const L = d.participantes.filter((l) => (l.variante === 'A' || l.variante === 'B') && !(semEx && l.ex_convidado));
  const e = d.estudo;
  const A = grupo(L, 'A', e), B = grupo(L, 'B', e), S = grupo(d.participantes, 'G', e);
  const G = { A, B, G: S };
  const grupos = [A, B, S];
  const todos = [...A.part, ...B.part, ...S.part]; // toda a gente com pelo menos 1 subida válida
  const total = A.n + B.n;
  const obj = CONFIG.objetivoParticipantes, min = CONFIG.minimoParticipantes;
  const diasEstudo = diasEntre(e.inicio, e.fim) + 1;
  const diaAtual = Math.max(0, Math.min(diasEstudo, diasEntre(e.inicio, e.hoje) + 1));
  const estado = e.hoje < e.inicio ? `começa a ${dataPt(e.inicio)}` : e.hoje > e.fim ? 'terminado' : `dia ${diaAtual} de ${diasEstudo}`;
  const taxaDe = (l) => l.subidas / Math.max(1, l.semanas_expostas);

  // Testes (só A vs B)
  const tH1 = teste(A.rep7, B.rep7), tSub7 = teste(A.sub7, B.sub7), tTaxa = teste(A.taxa, B.taxa);
  const tDias = teste(A.dias, B.dias), tAnd = teste(A.andares, B.andares);
  const fVolta = fisher(A.voltaram, A.n, B.voltaram, B.n);
  const fRep = fisher(A.comRep, A.n7, B.comRep, B.n7);
  const veredito = !tH1.r ? 'Ainda poucos dados para testar'
    : tH1.r.p < 0.05 ? 'A repete mais do que B'
    : e.hoje > e.fim ? 'Sem diferença significativa' : 'Ainda sem diferença significativa';

  // Leituras de toda a gente (as de A/B excluídas pelo filtro ficam de fora). Podem faltar se o pedido falhou.
  const exIds = new Set(d.participantes.filter((l) => l.ex_convidado && l.variante !== 'G').map((l) => l.id));
  const lv = (d.leituras || []).filter((x) => !(semEx && exIds.has(x.participante)));
  const validas = lv.filter((x) => x.resultado === 'valida');

  const mm = (a) => `${f1(media(a), 1)} / ${f1(mediana(a), 1)}`;
  // t = resultado de teste() ({ r, ef }) ou de fisher() ({ p } ou null)
  const linhaT = (rot, a, b, t) => {
    const mw = t != null && 'ef' in t;
    return `<tr><td>${rot}</td><td class="n">${a}</td><td class="n">${b}</td>
      <td class="n">${pc(mw ? t.r : t)}</td><td class="n">${mw ? efTxt(t.ef) : ''}</td></tr>`;
  };
  const prop = (k, n) => (n ? `${pct(k / n)} <span class="nota">(${k}/${n})</span>` : '—');
  const porGrupo = (f) => `A ${f(A)} · B ${f(B)} · sem grupo ${f(S)}`;
  const rec = recrutamento(d.diario, grupos);
  const sem = semanas(e, grupos);

  ecra.innerHTML = `
  <div class="dash">
    <header class="cabeca-painel">
      <div><h1>Painel do docente</h1>
        <p class="muted" style="margin:0">${dataPt(e.inicio)} – ${dataPt(e.fim)} · ${estado} ·
          atualizado às ${new Date(d.gerado_em).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</p></div>
      <div class="botoes">
        <button class="btn pequeno secundario" id="atualizar">Atualizar</button>
        <button class="btn pequeno secundario" id="sair">Sair</button>
      </div>
    </header>

    <div class="filtros" role="group" aria-label="Filtros (aplicam-se a todo o painel)">
      <label class="filtro"><input type="checkbox" id="testes" ${d.inclui_fora ? 'checked' : ''}>
        Incluir leituras de teste <span class="nota">(${d.scans_fora_estudo})</span></label>
      <label class="filtro"><input type="checkbox" id="sem-ex" ${semEx ? 'checked' : ''}>
        Excluir quem usou sem grupo antes de 20/11 <span class="nota">(A ${nEx.A} · B ${nEx.B})</span></label>
    </div>
    ${d.inclui_fora ? '<p class="aviso-caixa largo-total" style="margin:0"><strong>A mostrar leituras de teste.</strong> Não usar estes números na análise.</p>' : ''}

    <div class="kpis">
      ${kpi('Toda a gente', `${todos.length}<span class="de"> ${todos.length === 1 ? 'pessoa' : 'pessoas'}</span>`,
        `${porGrupo((g) => g.n)} · ${d.participantes.length} leram QR`)}
      ${kpi('Subidas válidas', ui.fmt(A.subidas + B.subidas + S.subidas), porGrupo((g) => ui.fmt(g.subidas)))}
      ${kpi('Participantes A/B', `${total}<span class="de"> / ${obj}</span>`,
        total >= min ? `Mínimo de ${min} atingido` : `Faltam ${min - total} para o mínimo (${min})`, total / obj)}
      ${kpi('Voltaram a subir', pct(todos.filter((l) => l.dias >= 2).length / todos.length), 'Subiram em 2 ou mais dias (toda a gente)')}
      ${kpi('Subidas por pessoa/semana', f1(media(todos.map(taxaDe)), 1), porGrupo((g) => f1(media(g.taxa), 1)))}
      ${kpi('Estudo', `${diaAtual}<span class="de"> / ${diasEstudo} dias</span>`, `Termina a ${dataPt(e.fim)}`, diaAtual / diasEstudo)}
    </div>

    <section class="cartao s5">
      <h2>H1 · subidas repetidas na 1.ª semana</h2>
      <p class="sub">A versão coletiva (A) faz repetir mais do que a pessoal (B)? Só A e B.</p>
      <div class="duelo">
        ${SERIES.map((s) => `<div><span class="chave"><i style="background:${s.cor}"></i>${s.nome}</span>
          <span class="valor">${Number.isFinite(media(G[s.id].rep7))
            ? media(G[s.id].rep7).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</span><span class="nota">média · n = ${G[s.id].n7}</span></div>`).join('')}
      </div>
      <p class="veredito"><strong>${veredito}</strong><br>
        <span class="nota">${fp(tH1.r)} · efeito ${efTxt(tH1.ef)}${efNome(tH1.ef) ? ` (${efNome(tH1.ef)})` : ''}</span></p>
      <div class="grafico" data-grafico="h1"></div>
      <p class="nota" style="margin:6px 0 0">Cada ponto é uma pessoa com a 1.ª semana completa (1.ª leitura há mais de 7 dias). O traço é a média.</p>
    </section>

    <section class="cartao s7">
      <h2>A vs B</h2>
      <p class="sub">Comparação do estudo: só A e B. Média / mediana por pessoa.</p>
      <div class="tabela-scroll"><table>
        <thead><tr><th></th><th class="n">${chave('A')}A</th><th class="n">${chave('B')}B</th><th class="n">p</th><th class="n">efeito</th></tr></thead>
        <tbody>
          ${linhaT('<strong>Repetidas na 1.ª semana (H1)</strong>', mm(A.rep7), mm(B.rep7), tH1)}
          ${linhaT('Subidas na 1.ª semana', mm(A.sub7), mm(B.sub7), tSub7)}
          ${linhaT('Subidas por semana', mm(A.taxa), mm(B.taxa), tTaxa)}
          ${linhaT('Dias com subida', mm(A.dias), mm(B.dias), tDias)}
          ${linhaT('Andares subidos', mm(A.andares), mm(B.andares), tAnd)}
          ${linhaT('Repetiram na 1.ª semana', prop(A.comRep, A.n7), prop(B.comRep, B.n7), fRep)}
          ${linhaT('Voltaram noutro dia', prop(A.voltaram, A.n), prop(B.voltaram, B.n), fVolta)}
        </tbody>
      </table></div>
      <p class="nota" style="margin:8px 0 0">p unilateral (A &gt; B): Mann–Whitney exato até ${MAX_EXATO} pessoas; Fisher exato nas proporções.
        Efeito: rank-biserial, de −1 a +1 (+ = A maior).</p>
    </section>

    <section class="cartao s12">
      <div class="titulo-linha"><h2>Subidas válidas por dia</h2>${legenda(SERIES3)}</div>
      <div class="grafico" data-grafico="dia"></div>
      ${vista(['Dia', 'A', 'A pessoas', 'B', 'B pessoas', 'Sem grupo', 'Sem grupo pessoas'],
        d.diario.map((x) => [dataPt(x.dia), x.A, x.A_pessoas, x.B, x.B_pessoas, x.G ?? 0, x.G_pessoas ?? 0]))}
    </section>

    ${cartaoPessoas(d, semEx)}

    <section class="cartao s6">
      <div class="titulo-linha"><h2>Pessoas ao longo do estudo</h2>${legenda(SERIES3, 'linha')}</div>
      <div class="grafico" data-grafico="recrutamento"></div>
      ${vista(['Dia', 'A', 'B', 'Sem grupo', 'Total'], rec.map((x) => [dataPt(x.dia), x.A, x.B, x.G, x.A + x.B + x.G]))}
    </section>

    <section class="cartao s6">
      <div class="titulo-linha"><h2>Subidas por pessoa, por semana</h2>${legenda(SERIES3, 'linha')}</div>
      <div class="grafico" data-grafico="semanas"></div>
      ${vista(['Semana', 'A média', 'A n', 'B média', 'B n', 'Sem grupo média', 'Sem grupo n'], sem.map((s) =>
        [`${s.rot} (${dataPt(s.ini)}–${dataPt(s.fim)})`, f1(s.A, 2), s.nA, f1(s.B, 2), s.nB, f1(s.G, 2), s.nG]))}
    </section>

    <section class="cartao s6">
      <div class="titulo-linha"><h2>A que horas sobem</h2>${legenda(SERIES3)}</div>
      <div class="grafico" data-grafico="horas"></div>
      ${d.leituras ? vista(['Hora', 'A', 'B', 'Sem grupo'], porHora(validas).map((x) => [x.rot, x.v.A, x.v.B, x.v.G])) : ''}
    </section>

    <section class="cartao s6">
      <div class="titulo-linha"><h2>Dia da semana</h2>${legenda(SERIES3)}</div>
      <div class="grafico" data-grafico="semana"></div>
      ${d.leituras ? vista(['Dia', 'A', 'B', 'Sem grupo'], porDiaSemana(validas).map((x) => [x.rot, x.v.A, x.v.B, x.v.G])) : ''}
    </section>

    <section class="cartao s6">
      <div class="titulo-linha"><h2>Quantas vezes cada pessoa subiu</h2>${legenda(SERIES3)}</div>
      <div class="grafico" data-grafico="distribuicao"></div>
      ${vista(['Subidas', 'Pessoas A', 'Pessoas B', 'Pessoas sem grupo'], distribuicao(grupos).map((x) => [x.rot, x.v.A, x.v.B, x.v.G]))}
    </section>

    <section class="cartao s6">
      <h2>Meta semanal</h2>
      <p class="sub">É igual em todas as versões: serve para ver se explica diferenças entre A e B.</p>
      <div class="tabela-scroll"><table>
        <thead><tr><th></th><th class="n">${chave('A')}A</th><th class="n">${chave('B')}B</th><th class="n"><i class="chave-cor" style="background:var(--neutro-forte)"></i>Sem grupo</th></tr></thead>
        <tbody>
          <tr><td>Escolheram uma meta</td>${grupos.map((g) => `<td class="n">${prop(g.nMeta, g.n)}</td>`).join('')}</tr>
          <tr><td>Meta média (vezes/semana)</td>${grupos.map((g) => `<td class="n">${f1(g.metaMedia, 1)}</td>`).join('')}</tr>
          <tr><td>Cumpriram pelo menos 1 semana</td>${grupos.map((g) => `<td class="n">${prop(g.cumpriu, g.nMeta)}</td>`).join('')}</tr>
        </tbody>
      </table></div>
    </section>

    ${cartaoQualidade(d, validas)}

    <section class="cartao s6">
      <h2>Percursos mais comuns</h2>
      <p class="sub">Subidas válidas de toda a gente, do piso de partida ao de chegada</p>
      ${percursos(validas, d.leituras)}
    </section>

    ${cartaoMeta(d.coletivo)}

    <section class="cartao s6">
      <h2>Exportar CSV</h2>
      <p class="sub">Anónimo: P001, P002… (iguais nos três ficheiros). Têm toda a gente, incluindo “sem grupo”.</p>
      <div class="botoes">
        <button class="btn pequeno" id="csv-part">Participantes</button>
        <button class="btn pequeno" id="csv-dia">Dias</button>
        <button class="btn pequeno" id="csv-leituras">Leituras</button>
      </div>
      <details class="como" style="margin-top:14px"><summary>Como se calcula</summary>
        <ul class="nota">
          <li>Toda a gente = quem tem pelo menos 1 subida válida (A, B e sem grupo). Participantes A/B = só A e B:
            é com eles que se faz o H1 e a tabela A vs B. “Sem grupo” = quem usou sem conta antes de 20/11 (via o coletivo).</li>
          <li>1.ª semana = 7 dias desde a 1.ª leitura; só conta quem a completou até ${dataPt(e.fim)}.
            Repetidas = subidas nessa semana menos a primeira.</li>
          <li>Subidas por semana = subidas ÷ semanas desde a 1.ª leitura (mínimo 1).</li>
          <li>Ler o QR em cada piso seguido é uma só subida (com mais andares), não várias.</li>
          <li>Regras: ${d.regras.min_seg_por_andar}–${d.regras.max_seg_por_andar} s por andar,
            ${Math.round(d.regras.cooldown_seg / 60)} min entre subidas. Contas criadas: ${d.contas ?? 0}.</li>
          <li>Confirmar os testes no R/SPSS com o CSV de participantes.</li>
        </ul>
      </details>
    </section>

    ${cartaoManuais(d)}
  </div>`;

  // Gráficos: desenhados à largura real de cada cartão (e outra vez quando a janela muda).
  const dd = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  montarGraficos({
    h1: (w) => svgPontos(w, SERIES.map((s) => ({ ...s, pontos: G[s.id].h1.map((l) => ({ id: l.id, v: Math.max(0, l.subidas_7d - 1) })) })),
      { vazio: 'Aparece quando houver pessoas com a 1.ª semana completa (7 dias desde a 1.ª leitura).', unidade: ['repetida', 'repetidas'] }),
    dia: (w) => svgColunas(w, d.diario.map((x) => ({
      rot: dd(x.dia), v: { A: x.A, B: x.B, G: x.G ?? 0 },
      tip: dicaHtml(dataPt(x.dia), [
        { cor: 'var(--serie-a)', valor: x.A, txt: `A · ${x.A_pessoas} ${x.A_pessoas === 1 ? 'pessoa' : 'pessoas'}` },
        { cor: 'var(--serie-b)', valor: x.B, txt: `B · ${x.B_pessoas} ${x.B_pessoas === 1 ? 'pessoa' : 'pessoas'}` },
        { cor: 'var(--neutro-forte)', valor: x.G ?? 0, txt: `sem grupo · ${x.G_pessoas ?? 0} ${x.G_pessoas === 1 ? 'pessoa' : 'pessoas'}` }]),
    })), { series: SERIES3, h: 240, vazio: 'O gráfico aparece quando o estudo começar.' }),
    recrutamento: (w) => svgLinhas(w, rec.map((x) => dd(x.dia)), SERIES3.map((s) => ({ ...s, valores: rec.map((x) => x[s.id]) })),
      { tips: rec.map((x) => dicaHtml(`${dataPt(x.dia)} · total ${x.A + x.B + x.G}`, SERIES3.map((s) => ({ cor: s.cor, valor: x[s.id], txt: s.nome })))) }),
    semanas: (w) => svgLinhas(w, sem.map((x) => x.rot), SERIES3.map((se) => ({ ...se, valores: sem.map((x) => x[se.id]) })), {
      inteiro: false, minEsp: 30,
      tips: sem.map((x) => dicaHtml(`${x.rot}: ${dataPt(x.ini)}–${dataPt(x.fim)}`, SERIES3.map((s) =>
        ({ cor: s.cor, valor: f1(x[s.id], 2), txt: `${s.nome} · n = ${x['n' + s.id]}` })))) }),
    horas: (w) => (d.leituras ? svgColunas(w, porHora(validas).map((x) => ({ ...x, tip: dicaGrupos(`${x.rot}h`, x.v) })),
      { series: SERIES3, vazio: 'Ainda sem subidas.', minEsp: 30 }) : semLeituras()),
    semana: (w) => (d.leituras ? svgColunas(w, porDiaSemana(validas).map((x) => ({ ...x, tip: dicaGrupos(x.rot, x.v) })),
      { series: SERIES3, vazio: 'Ainda sem subidas.', minEsp: 30 }) : semLeituras()),
    distribuicao: (w) => svgColunas(w, distribuicao(grupos).map((x) => ({
      ...x, tip: dicaGrupos(`${x.rot} ${x.rot === '1' ? 'subida' : 'subidas'}`, x.v, ['pessoa', 'pessoas']) })),
    { series: SERIES3, vazio: 'Ainda sem participantes.', minEsp: 30 }),
  });

  // Botões e filtros
  document.getElementById('atualizar').onclick = () => entrar(sessionStorage.getItem(CHAVE) || '');
  document.getElementById('sair').onclick = () => { sessionStorage.removeItem(CHAVE); mostrarLogin(); };
  const suf = d.inclui_fora ? '-com-testes' : '';
  document.getElementById('csv-part').onclick = () => descarregar(`sobe-participantes${suf}.csv`, csvParticipantes(d));
  document.getElementById('csv-dia').onclick = () => descarregar(`sobe-diario${suf}.csv`, csvDiario(d));
  document.getElementById('csv-leituras').onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.textContent = 'A preparar…';
    try {
      let lista = d.leituras;
      if (!lista) {
        const r = await rpc('painel_leituras', { p_password: sessionStorage.getItem(CHAVE) || '', p_incluir_fora: d.inclui_fora });
        if (!r.ok) throw new Error(r.erro);
        lista = r.leituras;
      }
      descarregar(`sobe-leituras${suf}.csv`, csv([
        ['participante', 'variante', 'data', 'hora', 'piso_origem', 'piso', 'resultado', 'segundos', 'andares', 'no_estudo'],
        ...lista.map((x) => [x.participante, x.variante, x.data, x.hora, x.piso_origem, x.piso, x.resultado,
          x.segundos, x.andares, x.no_estudo ? 'sim' : 'nao'])]));
    } catch (err) {
      console.error(err); alert('Não foi possível exportar. Tenta outra vez.');
    } finally { b.disabled = false; b.textContent = 'Leituras'; }
  };
  document.getElementById('sem-ex').onchange = (ev) => {
    try { sessionStorage.setItem(CHAVE_EX, ev.target.checked ? '1' : '0'); } catch { /* */ }
    mostrarPainel(dados);
  };
  document.getElementById('testes').onchange = (ev) => {
    try { sessionStorage.setItem(CHAVE_TESTES, ev.target.checked ? '1' : '0'); } catch { /* */ }
    entrar(sessionStorage.getItem(CHAVE) || '');
  };
  ligarManuais();
  ligarDicas(ecra.querySelector('.dash'));
}

// ---------------------------------------------------------------------
// Subidas registadas à mão (quem subiu mas se esqueceu do QR)
// ---------------------------------------------------------------------
let avisoManual = null;      // { ok, txt } mostrado depois de recarregar o painel
let ultimaAlcunha = '';      // para registar várias subidas da mesma pessoa seguidas
const ERROS_MANUAL = {
  sem_alcunha: 'Não há nenhuma conta com essa alcunha. (Quem usa sem conta não pode ser registado aqui.)',
  pisos: 'O piso de chegada tem de ser acima do de partida. Descer não conta.',
  quando: 'A data e a hora têm de ser dos últimos 14 dias e não podem ser no futuro.',
  duplicada: 'Essa pessoa já tem uma subida registada perto dessa hora (10 min).',
  bloqueado: 'Demasiadas tentativas falhadas. Espera 15 minutos.',
  password: 'A sessão do painel expirou. Sai e entra outra vez.',
};

// Só as subidas registadas neste navegador nos últimos 5 minutos aparecem (para desfazer um engano).
const CHAVE_REG = 'sobe_painel_registadas';
const JANELA_DESFAZER = 5 * 60 * 1000;
function registadasRecentes() {
  try {
    const o = JSON.parse(sessionStorage.getItem(CHAVE_REG) || '{}');
    return Object.fromEntries(Object.entries(o).filter(([, t]) => Date.now() - t < JANELA_DESFAZER));
  } catch { return {}; }
}
function guardarRegistada(id) {
  const o = { ...registadasRecentes(), [id]: Date.now() };
  try { sessionStorage.setItem(CHAVE_REG, JSON.stringify(o)); } catch { /* */ }
}

function cartaoManuais(d) {
  const e = d.estudo;
  const pisos = CONFIG.pisos.map((p) => `<option value="${p}">Piso ${p}</option>`).join('');
  const rec = registadasRecentes();
  const lista = (d.manuais || []).filter((m) => rec[m.id]);
  const minDia = [e.inicio, somar(e.hoje, -13)].sort().at(-1);
  return `<section class="cartao s12" id="manuais">
    <h2>Registar subida esquecida</h2>
    <p class="sub">Para subidas em que a pessoa se esqueceu de ler o QR. Contam como qualquer outra subida.</p>
    <form id="form-manual" class="form-manual" novalidate>
      <label>Alcunha<input type="text" id="m-u" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(ultimaAlcunha)}"></label>
      <label>Dia<input type="date" id="m-dia" required value="${e.hoje}" min="${minDia}" max="${e.hoje}"></label>
      <label>Hora<input type="time" id="m-hora" required></label>
      <label>De<select id="m-de">${pisos}</select></label>
      <label>Até<select id="m-ate">${pisos}</select></label>
      <button class="btn pequeno" type="submit">Registar</button>
    </form>
    ${avisoManual ? `<p class="${avisoManual.ok ? 'ok-caixa' : 'aviso-caixa'}" role="status" style="margin:12px 0 0">${esc(avisoManual.txt)}</p>` : ''}
    ${lista.length ? `<div class="tabela-scroll" id="recentes" style="margin-top:12px"><table>
      <thead><tr><th>Pessoa</th><th>Grupo</th><th>Dia</th><th>Hora</th><th>Subida</th><th></th></tr></thead>
      <tbody>${lista.map((m) => `<tr data-expira="${rec[m.id] + JANELA_DESFAZER}"><td>${esc(m.participante ?? '—')}</td><td>${esc(m.variante)}</td><td>${dataPt(m.dia)}</td>
        <td>${esc(m.hora)}</td><td>Piso ${m.piso_origem} → ${m.piso}${m.no_estudo ? '' : ' <span class="nota">(fora do estudo)</span>'}</td>
        <td class="n"><button class="ligacao-btn" type="button" data-apagar="${Number(m.id)}" style="min-height:0;padding:0">Apagar</button></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="nota" style="margin:6px 0 0">Enganaste-te? Podes apagar durante 5 minutos.</p>` : ''}
  </section>`;
}

function ligarManuais() {
  const form = document.getElementById('form-manual');
  if (!form) return;
  // De: piso 0; Até: o piso acima (o caso mais comum).
  document.getElementById('m-de').value = '0';
  document.getElementById('m-ate').value = '1';
  avisoManual = null;
  const pw = () => sessionStorage.getItem(CHAVE) || '';
  // Cada linha some ao fim dos 5 minutos; sem linhas, some a tabela e a nota.
  document.querySelectorAll('#recentes tr[data-expira]').forEach((tr) => setTimeout(() => {
    const caixa = tr.closest('#recentes');
    tr.remove();
    if (caixa && !caixa.querySelector('tr[data-expira]')) { caixa.nextElementSibling?.remove(); caixa.remove(); }
  }, Math.max(0, Number(tr.dataset.expira) - Date.now())));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const val = (id) => document.getElementById(id).value;
    const u = val('m-u').trim().toLowerCase();
    if (!u || !val('m-dia') || !val('m-hora')) {
      avisoManual = { ok: false, txt: 'Preenche a alcunha, o dia e a hora.' };
      return mostrarPainel(dados);
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    let r;
    try {
      r = await rpc('painel_registar_subida', { p_password: pw(), p_utilizador: u, p_dia: val('m-dia'),
        p_hora: val('m-hora'), p_origem: Number(val('m-de')), p_destino: Number(val('m-ate')) });
    } catch (err) {
      console.error(err);
      r = { ok: false, erro: 'rede' };
    }
    ultimaAlcunha = u;
    if (r.ok) guardarRegistada(r.id);
    avisoManual = r.ok
      ? { ok: true, txt: `Registada: ${val('m-dia').split('-').reverse().join('/')} às ${val('m-hora')}, piso ${val('m-de')} → ${val('m-ate')} (${r.andares} ${r.andares === 1 ? 'andar' : 'andares'}, grupo ${r.variante}).` }
      : { ok: false, txt: ERROS_MANUAL[r.erro] ?? 'Não foi possível registar. Tenta outra vez.' };
    if (r.ok) await entrar(pw()); else mostrarPainel(dados);
    document.getElementById('manuais')?.scrollIntoView({ block: 'nearest' });
  });
  document.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Apagar esta subida?')) return;
    b.disabled = true;
    try {
      const r = await rpc('painel_apagar_subida', { p_password: pw(), p_id: Number(b.dataset.apagar) });
      avisoManual = r.ok ? { ok: true, txt: 'Subida apagada.' } : { ok: false, txt: 'Não foi possível apagar.' };
    } catch (err) {
      console.error(err); avisoManual = { ok: false, txt: 'Sem ligação ao servidor.' };
    }
    await entrar(pw());
    document.getElementById('manuais')?.scrollIntoView({ block: 'nearest' });
  }));
}

// ---------------------------------------------------------------------
// Peças do painel
// ---------------------------------------------------------------------
const chave = (v) => `<i class="chave-cor" style="background:var(--serie-${v.toLowerCase()})"></i>`;

function kpi(rotulo, valor, nota, fracao) {
  return `<section class="cartao kpi">
    <div class="rotulo">${rotulo}</div>
    <div class="valor">${valor}</div>
    ${fracao != null ? `<div class="medidor"><span style="width:${Math.max(0, Math.min(100, fracao * 100))}%"></span></div>` : ''}
    <div class="nota">${nota}</div>
  </section>`;
}

function legenda(series, tipo = 'barra') {
  return `<div class="legenda">${series.map((s) => `<span><i class="${tipo}" style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>`;
}

/** Tabela equivalente ao gráfico (acessível e sem precisar de passar o rato). */
function vista(cab, linhas) {
  if (!linhas.length) return '';
  return `<details class="vista"><summary>Ver tabela</summary><div class="tabela-scroll"><table>
    <thead><tr>${cab.map((c, i) => `<th${i ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

/** Dica: o valor primeiro (forte), o nome a seguir; chave em traço da cor da série. */
function dicaHtml(titulo, linhas) {
  return `<div class="dica-titulo">${esc(titulo)}</div>${linhas.map((l) =>
    `<div><i style="background:${l.cor}"></i><b>${esc(l.valor)}</b> ${esc(l.txt)}</div>`).join('')}`;
}
const dicaGrupos = (titulo, v, un = ['subida', 'subidas']) => dicaHtml(titulo, SERIES3.map((s) =>
  ({ cor: s.cor, valor: v[s.id], txt: `${v[s.id] === 1 ? un[0] : un[1]} · ${s.nome}` })));
const semLeituras = () => '<p class="muted vazio">Não foi possível carregar as leituras. Carrega em Atualizar.</p>';

/** Pessoas acumuladas por grupo (por dia da 1.ª leitura). grupos = resultados de grupo() (A, B, G). */
function recrutamento(diario, grupos) {
  return diario.map((x) => ({
    dia: x.dia,
    ...Object.fromEntries(grupos.map((g) => [g.v, g.part.filter((l) => l.primeiro_dia <= x.dia).length])),
  }));
}

/** Subidas por pessoa em cada semana do estudo (só quem já tinha começado), até à semana atual. */
function semanas(e, grupos) {
  const out = [];
  for (let k = 1; k <= dados.estudo.semanas; k++) {
    const ini = somar(e.inicio, (k - 1) * 7);
    if (ini > e.hoje && k > 1) break;
    const fim = minStr(somar(ini, 6), e.fim);
    const linha = { rot: `S${k}`, ini, fim };
    grupos.forEach((g) => {
      const a = g.part.filter((l) => l.primeiro_dia <= fim).map((l) => l.por_semana[k - 1] ?? 0);
      linha[g.v] = a.length ? media(a) : null;
      linha[`n${g.v}`] = a.length;
    });
    out.push(linha);
  }
  return out;
}

function contarGrupos(lista, chaveDe, chaves) {
  const v = new Map(chaves.map((k) => [k, { A: 0, B: 0, G: 0 }]));
  lista.forEach((x) => { const k = chaveDe(x); if (v.has(k) && x.variante in v.get(k)) v.get(k)[x.variante]++; });
  return v;
}

function porHora(validas) {
  const horas = validas.map((x) => Number(x.hora.slice(0, 2)));
  const ini = Math.min(7, ...horas), fim = Math.max(20, ...horas);
  const ks = Array.from({ length: fim - ini + 1 }, (_, i) => ini + i);
  const v = contarGrupos(validas, (x) => Number(x.hora.slice(0, 2)), ks);
  return ks.map((h) => ({ rot: String(h), v: v.get(h) }));
}

function porDiaSemana(validas) {
  const v = contarGrupos(validas, (x) => (new Date(`${x.data}T12:00:00Z`).getUTCDay() + 6) % 7, [0, 1, 2, 3, 4, 5, 6]);
  return DIAS_SEMANA.map((rot, i) => ({ rot, v: v.get(i) }));
}

function distribuicao(grupos) {
  const classes = [['1', 1, 1], ['2', 2, 2], ['3–4', 3, 4], ['5–9', 5, 9], ['10–19', 10, 19], ['20+', 20, Infinity]];
  return classes.map(([rot, a, b]) => ({
    rot, v: Object.fromEntries(grupos.map((g) => [g.v, g.part.filter((l) => l.subidas >= a && l.subidas <= b).length])),
  }));
}

/** Uma linha por cada ID que leu pelo menos um QR no período (toda a gente, mesmo sem subida válida). */
function cartaoPessoas(d, semEx) {
  const nome = { A: 'A · coletivo', B: 'B · pessoal', G: 'Sem grupo' };
  const cor = { A: 'var(--serie-a)', B: 'var(--serie-b)', G: 'var(--neutro-forte)' };
  const alturas = Object.values(CONFIG.alturaLanco);
  const mPorAndar = alturas.length ? media(alturas) : 3;
  const analise = (l) => (l.variante === 'G' ? 'não · sem grupo'
    : l.subidas < 1 ? 'não · sem subida válida'
    : semEx && l.ex_convidado ? 'não · excluído pelo filtro' : 'sim');
  const comSubida = d.participantes.filter((l) => l.subidas >= 1).length;
  const linhas = d.participantes.map((l) => `<tr class="${l.subidas >= 1 ? '' : 'apagado'}">
      <td><strong>${esc(l.id)}</strong></td>
      <td><i class="chave-cor" style="background:${cor[l.variante] ?? 'var(--neutro)'}"></i>${nome[l.variante] ?? esc(l.variante)}</td>
      <td>${l.tem_conta ? 'sim' : 'não'}</td><td>${dataPt(l.primeiro_dia)}</td>
      <td class="n">${l.n_scans}</td><td class="n">${l.subidas}</td>
      <td class="n">${l.andares}</td><td class="n">${ui.fmt(l.andares * mPorAndar, 1)}</td>
      <td class="n">${l.dias}</td><td class="n">${l.meta_semanal ? `${l.meta_semanal}×` : '—'}</td><td>${analise(l)}</td></tr>`).join('');
  return `<section class="cartao s12">
    <div class="titulo-linha"><h2>Todas as pessoas</h2>
      <span class="nota">${d.participantes.length} leram pelo menos um QR · ${comSubida} com subida válida</span></div>
    <div class="tabela-scroll tabela-alta"><table>
      <thead><tr><th>Pessoa</th><th>Grupo</th><th>Conta</th><th>1.ª leitura</th><th class="n">Leituras</th><th class="n">Subidas</th>
        <th class="n">Andares</th><th class="n">Metros</th><th class="n">Dias</th><th class="n">Meta</th><th>Na análise A/B</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="11" class="muted">Ainda ninguém leu um QR.</td></tr>'}</tbody>
    </table></div>
    <p class="nota" style="margin:8px 0 0">Leituras = todos os QR lidos (inícios, continuações, rejeitadas…). Subidas = subidas válidas.
      Quem só leu o QR de partida aparece a cinzento.</p>
  </section>`;
}

function percursos(validas, temLeituras) {
  if (!temLeituras) return semLeituras();
  if (!validas.length) return '<p class="muted vazio">Ainda sem subidas.</p>';
  const c = new Map();
  validas.forEach((x) => { const k = `${x.piso_origem} → ${x.piso}`; c.set(k, (c.get(k) || 0) + 1); });
  const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0][1];
  const andares = media(validas.map((x) => x.andares));
  return `<div class="hbarras">${top.map(([k, n]) => `<div class="hb" data-tip="${esc(dicaHtml(`Piso ${k}`, [{ cor: 'var(--neutro-forte)', valor: n, txt: n === 1 ? 'subida' : 'subidas' }]))}">
      <span class="hb-rot">Piso ${esc(k)}</span><span class="hb-trilho"><span style="width:${(n / max) * 100}%"></span></span>
      <span class="hb-val">${n}</span></div>`).join('')}</div>
    <p class="nota" style="margin:10px 0 0">Em média, ${f1(andares, 1)} andares por subida.</p>`;
}

/** Qualidade dos dados: leituras válidas, inícios e rejeitadas por grupo + tempo por andar. */
function cartaoQualidade(d, validas) {
  const q = d.qualidade;
  if (!q) return '';
  const tipos = [
    ['valida', 'Válida'], ['continua', 'Continuou (+andares)'], ['inicio', 'Início'], ['descer', 'Desceu'],
    ['rapido', 'Rápido demais'], ['lento', 'Muito tempo'], ['cooldown', 'Intervalo 5 min'], ['repetido', 'QR 2× seguidas'],
  ];
  const classes = [
    { nome: 'Subida', tipos: ['valida', 'continua'], cor: 'var(--seg-ok)', tinta: 'var(--seg-ok-t)' },
    { nome: 'Início', tipos: ['inicio', 'descer', 'lento'], cor: 'var(--neutro)', tinta: 'var(--neutro-t)' },
    { nome: 'Rejeitada', tipos: ['rapido', 'cooldown', 'repetido'], cor: 'var(--seg-rej)', tinta: 'var(--seg-rej-t)' },
  ];
  const col = (g, t) => q.resultados?.[g]?.[t] ?? 0;
  const tot = (g) => tipos.reduce((s, [t]) => s + col(g, t), 0);
  const grupos = [['A', 'A · coletivo'], ['B', 'B · pessoal'], ['G', 'Sem grupo']].filter(([g]) => g !== 'G' || tot(g));
  const barras = grupos.map(([g, nome]) => {
    const t = tot(g);
    const partes = classes.map((c) => ({ ...c, v: c.tipos.reduce((s, x) => s + col(g, x), 0) })).filter((p) => p.v > 0);
    return `<div class="seg-linha"><span class="seg-rot">${nome}<span class="nota">${t} leituras</span></span>
      <div class="seg" role="img" aria-label="${nome}: ${partes.map((p) => `${p.nome} ${pct(p.v / t)}`).join(', ')}">${partes.map((p) =>
        `<span data-tip="${esc(dicaHtml(nome, [{ cor: p.cor, valor: `${pct(p.v / t)} (${p.v})`, txt: p.nome }]))}"
          style="flex:${p.v} 1 0;background:${p.cor};color:${p.tinta}">${p.v / t >= 0.14 ? pct(p.v / t) : ''}</span>`).join('') || '<span class="seg-vazio"></span>'}</div></div>`;
  }).join('');
  const segAndar = (g) => mediana(validas.filter((x) => x.variante === g && x.andares > 0 && x.segundos != null).map((x) => x.segundos / x.andares));
  const cA = q.contas_por_grupo?.A ?? 0, cB = q.contas_por_grupo?.B ?? 0;
  const linhas = tipos.map(([t, rot]) => [rot, ...grupos.map(([g]) => col(g, t))]);
  return `<section class="cartao s6">
    <div class="titulo-linha"><h2>Qualidade dos dados</h2>${legenda(classes)}</div>
    <div class="seg-lista">${barras}</div>
    <p class="nota" style="margin:12px 0 0">Tempo por andar nas subidas válidas (mediana): A ${f1(segAndar('A'), 0)} s · B ${f1(segAndar('B'), 0)} s.
      Contas: A ${cA} · B ${cB}${Math.abs(cA - cB) <= 1 ? '' : ' (desequilibrado)'} · sem leituras: ${q.contas_sem_leituras ?? 0}.
      Muitas rejeitadas = regras mal percebidas.</p>
    ${vista(['Leitura', ...grupos.map(([, n]) => n)], [...linhas, ['Total', ...grupos.map(([g]) => tot(g))]])}
  </section>`;
}

/** Meta coletiva tal como está agora na app (o mesmo que a versão A vê no telemóvel). */
function cartaoMeta(c) {
  if (!c) return '';
  const rota = CONFIG.rotaColetiva;
  const total = metros(c.lancos);
  const p = progressoRota(total, rota);
  const topo = p.topo;
  const ticks = p.marcos.filter((m) => m !== topo)
    .map((m) => `<i style="left:${(m.altitude / topo.altitude) * 100}%" title="${m.nome}"></i>`).join('');
  const lista = p.marcos.map((m) => {
    const cls = m.altitude <= p.atual ? 'feito' : (m === p.proximo ? 'proximo' : '');
    return `<li class="${cls}"><span>${m.nome}</span><span class="num" style="font-weight:700">${ui.fmt(m.altitude)} m</span></li>`;
  }).join('');
  return `<section class="cartao s6">
    <h2>Meta coletiva</h2>
    <p class="sub">O que a versão A vê na app (todas as leituras válidas, todos os grupos)</p>
    ${p.voltas >= 1 ? `<p style="margin:0 0 6px"><strong>${p.subidaN}.ª subida ao ${topo.nome}</strong></p>` : ''}
    <div style="margin:0 0 12px"><span class="metros-grande">${ui.fmt(p.atual, 1)}</span>
      <span class="muted"> m de ${ui.fmt(topo.altitude)} m · ${topo.nome}</span></div>
    <div class="barra" role="progressbar" aria-label="${rota.titulo}"
      aria-valuemin="0" aria-valuemax="${topo.altitude}" aria-valuenow="${Math.round(p.atual)}">
      <span style="width:${p.pct * 100}%"></span></div>
    <div class="marcos" aria-hidden="true">${ticks}</div>
    <p style="margin:0">Próxima: <strong>${p.proximo.nome}</strong> · faltam ${ui.fmt(p.falta, 1)} m</p>
    <p class="nota" style="margin:4px 0 0">${ui.fmt(c.subidas)} subidas · ${ui.fmt(c.pessoas)} pessoas</p>
    <details class="vista"><summary>Todas as metas</summary><ul class="lista-marcos">${lista}</ul></details>
  </section>`;
}

// ---------------------------------------------------------------------
// Gráficos (SVG, sem bibliotecas). Desenhados à largura real do cartão.
// ---------------------------------------------------------------------
let observador = null;
function montarGraficos(defs) {
  observador?.disconnect();
  const desenhar = (el) => {
    const w = Math.floor(el.clientWidth);
    if (!w || Number(el.dataset.w) === w) return;
    el.dataset.w = w;
    el.innerHTML = defs[el.dataset.grafico]?.(w) ?? '';
  };
  observador = typeof ResizeObserver === 'function' ? new ResizeObserver((en) => en.forEach((x) => desenhar(x.target))) : null;
  ecra.querySelectorAll('[data-grafico]').forEach((el) => { observador?.observe(el); desenhar(el); });
}

/** Passo "redondo" para o eixo y. */
function eixo(max, inteiro = true, ticks = 4) {
  const m = Math.max(max, inteiro ? 1 : 0.5);
  const bruto = m / ticks;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  let passo = (inteiro ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).map((k) => k * mag).find((p) => p >= bruto - 1e-9);
  if (inteiro) passo = Math.max(1, Math.round(passo));
  return { passo, topo: Math.ceil(m / passo - 1e-9) * passo };
}

const svg = (w, h, corpo, rotulo) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(rotulo)}">${corpo}</svg>`;

function grelhaY(m, w, ih, topo, passo, fmt) {
  let s = '';
  for (let i = 0; i * passo <= topo + 1e-9; i++) {
    const v = i * passo, yy = m.t + ih - (v / topo) * ih;
    s += `<line class="grade" x1="${m.l}" x2="${w - m.r}" y1="${yy}" y2="${yy}"/>
      <text class="eixo" x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  return s;
}

/** Coluna com o topo arredondado (4px) e a base direita. */
function coluna(x, yt, yb, w, cor) {
  const h = yb - yt;
  if (h <= 0.5) return '';
  const r = Math.min(4, w / 2, h);
  return `<path d="M${x},${yb}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + w - r}Q${x + w},${yt} ${x + w},${yt + r}V${yb}Z" fill="${cor}"/>`;
}

/** Colunas agrupadas (A e B lado a lado, 2px de intervalo). cats = [{ rot, v: {A, B}, tip }] */
function svgColunas(w, cats, { series = SERIES, h = 220, inteiro = true, minEsp = 44, vazio = '' } = {}) {
  if (!cats.length || cats.every((c) => series.every((s) => !c.v[s.id]))) return `<p class="muted vazio">${vazio}</p>`;
  const m = { t: 12, r: 4, b: 26, l: 34 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const max = Math.max(0, ...cats.flatMap((c) => series.map((s) => c.v[s.id] || 0)));
  const { passo, topo } = eixo(max, inteiro);
  const y = (v) => m.t + ih - (v / topo) * ih;
  const bw = iw / cats.length, k = series.length;
  const barra = Math.max(2, Math.min(24, (bw * 0.72 - (k - 1) * 2) / k));
  const gw = k * barra + (k - 1) * 2;
  const cada = Math.ceil(cats.length / Math.max(1, Math.floor(iw / minEsp)));
  let s = grelhaY(m, w, ih, topo, passo, (v) => ui.fmt(v, inteiro ? 0 : 1));
  cats.forEach((c, i) => {
    const x0 = m.l + bw * i;
    s += `<g class="alvo" data-tip="${esc(c.tip)}"><rect class="faixa" x="${x0}" y="${m.t}" width="${bw}" height="${ih}" rx="6"/>`;
    series.forEach((se, j) => { s += coluna(x0 + (bw - gw) / 2 + j * (barra + 2), y(c.v[se.id] || 0), y(0), barra, se.cor); });
    s += '</g>';
    if (i % cada === 0) s += `<text class="eixo" x="${x0 + bw / 2}" y="${h - 8}" text-anchor="middle">${esc(c.rot)}</text>`;
  });
  return svg(w, h, s, 'Gráfico de colunas, A e B');
}

/** Linhas (2px) com marcadores; a mira vertical encontra o ponto mais próximo no eixo x. */
function svgLinhas(w, xs, series, { h = 220, inteiro = true, minEsp = 44, tips = [] } = {}) {
  const n = xs.length;
  if (!n) return '<p class="muted vazio">O gráfico aparece quando o estudo começar.</p>';
  const m = { t: 12, r: 14, b: 26, l: 34 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const max = Math.max(0, ...series.flatMap((s) => s.valores.filter((v) => v != null)));
  const { passo, topo } = eixo(max, inteiro);
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - (v / topo) * ih;
  const passoX = n === 1 ? iw : iw / (n - 1);
  const cada = Math.ceil(n / Math.max(1, Math.floor(iw / minEsp)));
  let s = grelhaY(m, w, ih, topo, passo, (v) => ui.fmt(v, inteiro ? 0 : 1));
  for (let i = 0; i < n; i++) {
    // Zona de toque: metade do intervalo para cada lado, sem sair da área do gráfico.
    const x0 = Math.max(m.l, x(i) - passoX / 2), x1 = Math.min(w - m.r, x(i) + passoX / 2);
    s += `<g class="alvo" data-tip="${esc(tips[i] ?? '')}"><rect x="${x0}" y="${m.t}" width="${x1 - x0}" height="${ih}" fill="transparent"/>
      <line class="mira" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ih}"/></g>`;
    if (i % cada === 0 || i === n - 1) s += `<text class="eixo" x="${x(i)}" y="${h - 8}" text-anchor="middle">${esc(xs[i])}</text>`;
  }
  let marcas = '';
  series.forEach((se) => {
    let d = '', caneta = false;
    se.valores.forEach((v, i) => {
      if (v == null) { caneta = false; return; }
      d += `${caneta ? 'L' : 'M'}${x(i)},${y(v)}`; caneta = true;
    });
    marcas += `<path d="${d}" fill="none" stroke="${se.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    se.valores.forEach((v, i) => {
      if (v == null || (n > 16 && i !== n - 1)) return;
      marcas += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${se.cor}" stroke="var(--superficie)" stroke-width="2"/>`;
    });
  });
  return svg(w, h, `${s}<g pointer-events="none">${marcas}</g>`, 'Gráfico de linhas');
}

/** Um ponto por pessoa (empates empilhados na vertical) e um traço na média de cada grupo. */
function svgPontos(w, grupos, { vazio = '', unidade = ['', ''] } = {}) {
  if (grupos.every((g) => !g.pontos.length)) return `<p class="muted vazio">${vazio}</p>`;
  const linhaH = 64, m = { t: 6, r: 16, b: 26, l: Math.min(110, w * 0.28) };
  const h = m.t + grupos.length * linhaH + m.b, iw = w - m.l - m.r;
  const max = Math.max(1, ...grupos.flatMap((g) => g.pontos.map((p) => p.v)));
  const { passo, topo } = eixo(max, true, Math.max(2, Math.min(6, Math.floor(iw / 50))));
  const x = (v) => m.l + (v / topo) * iw;
  let s = '';
  for (let i = 0; i * passo <= topo; i++) {
    const v = i * passo;
    s += `<line class="grade" x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${h - m.b}"/>
      <text class="eixo" x="${x(v)}" y="${h - 8}" text-anchor="middle">${v}</text>`;
  }
  grupos.forEach((g, gi) => {
    const cy = m.t + gi * linhaH + linhaH / 2;
    s += `<circle cx="7" cy="${cy}" r="5" fill="${g.cor}"/><text class="rot" x="18" y="${cy + 4}">${esc(g.nome.split(' · ')[0])}</text>
      <text class="eixo" x="18" y="${cy + 18}">n = ${g.pontos.length}</text>`;
    const porValor = new Map();
    g.pontos.forEach((p) => porValor.set(p.v, [...(porValor.get(p.v) || []), p]));
    const maxEmp = Math.max(1, ...[...porValor.values()].map((l) => l.length));
    const esp = Math.min(10, (linhaH - 16) / maxEmp);
    porValor.forEach((lista, v) => lista.forEach((p, j) => {
      const cyp = cy + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * esp;
      s += `<g class="alvo" data-tip="${esc(dicaHtml(p.id, [{ cor: g.cor, valor: v, txt: `${v === 1 ? unidade[0] : unidade[1]} · ${g.id}` }]))}">
        <circle cx="${x(v)}" cy="${cyp}" r="12" fill="transparent"/>
        <circle class="ponto" cx="${x(v)}" cy="${cyp}" r="4.5" fill="${g.cor}" stroke="var(--superficie)" stroke-width="2"/></g>`;
    }));
    const md = media(g.pontos.map((p) => p.v));
    if (Number.isFinite(md)) {
      s += `<line x1="${x(md)}" x2="${x(md)}" y1="${cy - linhaH / 2 + 6}" y2="${cy + linhaH / 2 - 6}" stroke="var(--texto)" stroke-width="2" stroke-linecap="round" pointer-events="none"/>`;
    }
  });
  return svg(w, h, s, 'Um ponto por pessoa, A e B');
}

/** Dica que segue o rato sobre qualquer elemento com data-tip. */
function ligarDicas(raiz) {
  if (!raiz) return;
  let ativo = null;
  const esconder = () => { dica.hidden = true; ativo?.classList.remove('ativo'); ativo = null; };
  raiz.addEventListener('pointermove', (ev) => {
    const a = ev.target.closest('[data-tip]');
    if (!a || !a.dataset.tip) return esconder();
    if (a !== ativo) { ativo?.classList.remove('ativo'); ativo = a; a.classList.add('ativo'); dica.innerHTML = a.dataset.tip; }
    dica.hidden = false;
    const bw = dica.offsetWidth, bh = dica.offsetHeight;
    let px = ev.clientX + 14, py = ev.clientY - bh - 12;
    if (px + bw > innerWidth - 8) px = ev.clientX - bw - 14;
    if (py < 8) py = ev.clientY + 18;
    dica.style.transform = `translate(${Math.max(8, px)}px, ${py}px)`;
  });
  raiz.addEventListener('pointerleave', esconder);
  addEventListener('scroll', esconder, { passive: true });
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
function csv(linhas) {
  const escCsv = (v) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return '﻿' + linhas.map((l) => l.map(escCsv).join(',')).join('\r\n');
}
function csvParticipantes(d) {
  const n = d.estudo.semanas;
  const cab = ['participante', 'variante', 'tem_conta', 'ex_convidado', 'primeiro_dia', 'leituras', 'subidas_validas', 'andares',
    'dias_diferentes', 'subidas_7d', 'repetidas_7d', 'janela_7d_completa', 'semanas_expostas', 'subidas_por_semana', 'meta_semanal',
    ...Array.from({ length: n }, (_, k) => `semana_${k + 1}`)];
  const rows = d.participantes.map((l) => [l.id, l.variante, l.tem_conta ? 'sim' : 'nao', l.ex_convidado ? 'sim' : 'nao', l.primeiro_dia, l.n_scans, l.subidas, l.andares,
    l.dias, l.subidas_7d, Math.max(0, l.subidas_7d - 1), janelaCompleta(l, d.estudo) ? 'sim' : 'nao', l.semanas_expostas,
    (l.subidas / Math.max(1, l.semanas_expostas)).toFixed(3), l.meta_semanal ?? '', ...l.por_semana]);
  return csv([cab, ...rows]);
}
function csvDiario(d) {
  return csv([['dia', 'A_subidas', 'A_pessoas', 'B_subidas', 'B_pessoas', 'sem_conta_subidas', 'sem_conta_pessoas'],
    ...d.diario.map((x) => [x.dia, x.A, x.A_pessoas, x.B, x.B_pessoas, x.G ?? 0, x.G_pessoas ?? 0])]);
}
function descarregar(nome, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------
function dataPt(s) {
  return new Date(`${s}T12:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function somar(s, n) { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const minStr = (a, b) => (a < b ? a : b);
const diasEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);

// ---------------------------------------------------------------------
const guardada = (() => { try { return sessionStorage.getItem(CHAVE); } catch { return null; } })();
if (guardada) entrar(guardada); else mostrarLogin();
