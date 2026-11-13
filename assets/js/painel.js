import { CONFIG } from '../../config.js';
import { rpc } from './api.js';
import * as ui from './ui.js';

const ecra = document.getElementById('ecra');
document.getElementById('topo').innerHTML = ui.cabecalho('../');
const CHAVE = 'sobe_painel';

// ---------------------------------------------------------------------
// Estatística
// ---------------------------------------------------------------------
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
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
/** Mann–Whitney U unilateral (H1: a > b), aproximação normal com correção de empates. */
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
  const sigma = Math.sqrt((n1 * n2 / 12) * ((N + 1) - empates / (N * (N - 1))));
  if (!sigma) return { U, z: 0, p: 0.5 };
  const z = (U - n1 * n2 / 2 - 0.5) / sigma;
  return { U, z, p: 1 - phi(z) };
}

const f1 = (x, c = 1) => (Number.isFinite(x) ? ui.fmt(x, c) : '—');
const pct = (x) => (Number.isFinite(x) ? `${ui.fmt(x * 100, 0)}%` : '—');
const fp = (r) => (r ? (r.p < 0.001 ? 'p < 0,001' : `p = ${ui.fmt(r.p, 3)}`) : 'dados insuficientes');

function grupo(linhas, v) {
  const ids = linhas.filter((l) => l.variante === v);
  const part = ids.filter((l) => l.subidas >= 1);
  const taxa = part.map((l) => l.subidas / Math.max(1, l.semanas_expostas));
  const sub7 = part.map((l) => l.subidas_7d);
  const rep7 = part.map((l) => Math.max(0, l.subidas_7d - 1));
  return {
    ids: ids.length, n: part.length, part, taxa, sub7, rep7,
    taxaMedia: media(taxa), taxaMediana: mediana(taxa),
    dois: part.length ? part.filter((l) => l.dias >= 2).length / part.length : NaN,
    sub7Media: media(sub7), sub7Mediana: mediana(sub7),
    rep7Media: media(rep7), rep7Mediana: mediana(rep7),
    rep7Algum: part.length ? rep7.filter((x) => x >= 1).length / part.length : NaN,
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
  ecra.innerHTML = '<div class="carregar"><div class="roda"></div><span>A carregar…</span></div>';
  let r;
  try { r = await rpc('painel', { p_password: pw }); } catch (e) {
    console.error(e); return mostrarLogin('Sem ligação ao servidor. Tenta outra vez.');
  }
  if (!r.ok) {
    try { sessionStorage.removeItem(CHAVE); } catch { /* */ }
    return mostrarLogin(r.erro === 'bloqueado'
      ? 'Demasiadas tentativas falhadas. Espera 15 minutos.' : 'Password incorreta.');
  }
  try { sessionStorage.setItem(CHAVE, pw); } catch { /* */ }
  mostrarPainel(r);
}

// ---------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------
let dados = null;

function mostrarPainel(d) {
  dados = d;
  const L = d.participantes;
  const A = grupo(L, 'A'), B = grupo(L, 'B');
  const total = A.n + B.n;
  const obj = CONFIG.objetivoParticipantes, min = CONFIG.minimoParticipantes;
  const e = d.estudo;
  const h1rep = mannWhitney(A.rep7, B.rep7);
  const h1sub = mannWhitney(A.sub7, B.sub7);
  const mwTaxa = mannWhitney(A.taxa, B.taxa);
  const estadoEstudo = e.hoje < e.inicio ? `Começa a ${dataPt(e.inicio)}`
    : e.hoje > e.fim ? 'Recolha terminada' : `A decorrer: dia ${diasEntre(e.inicio, e.hoje) + 1} de ${diasEntre(e.inicio, e.fim) + 1}`;

  const linha = (rot, a, b, nota = '') => `<tr><td>${rot}${nota ? `<div class="nota">${nota}</div>` : ''}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`;

  ecra.innerHTML = `
    <div class="meta-linha" style="align-items:center;flex-wrap:wrap">
      <div><h1 style="margin:8px 0 0">Painel do docente</h1>
        <p class="muted" style="margin:0">Estudo de ${dataPt(e.inicio)} a ${dataPt(e.fim)} · ${estadoEstudo}</p></div>
      <div class="botoes">
        <button class="btn pequeno secundario" id="atualizar">Atualizar</button>
        <a class="btn pequeno secundario" href="../cartazes/">Cartazes</a>
        <button class="btn pequeno secundario" id="sair">Sair</button>
      </div>
    </div>

    <div class="grelha">
      <section class="cartao kpi">
        <div class="rotulo">Participantes (≥ 1 subida válida)</div>
        <div class="valor num">${total}<span class="muted" style="font-size:1.1rem"> / ${obj}</span></div>
        <div class="barra alvo" style="margin:10px 0 6px"><span style="width:${Math.min(100, total / obj * 100)}%"></span></div>
        <div class="nota">Mínimo ${min}${total >= min ? ' — atingido' : ` — faltam ${min - total}`}</div>
      </section>
      <section class="cartao kpi">
        <div class="rotulo"><i style="background:var(--serie-a);width:10px;height:10px;border-radius:2px;display:inline-block"></i> Versão A · coletivo</div>
        <div class="valor num">${A.n}</div><div class="nota">${A.ids} IDs com pelo menos 1 leitura</div>
      </section>
      <section class="cartao kpi">
        <div class="rotulo"><i style="background:var(--serie-b);width:10px;height:10px;border-radius:2px;display:inline-block"></i> Versão B · pessoal</div>
        <div class="valor num">${B.n}</div><div class="nota">${B.ids} IDs com pelo menos 1 leitura</div>
      </section>
    </div>

    <section class="cartao">
      <h2>Comparação A vs B</h2>
      <div class="tabela-scroll"><table>
        <thead><tr><th>Métrica (participantes)</th><th class="n">A · coletivo</th><th class="n">B · pessoal</th></tr></thead>
        <tbody>
          ${linha('Participantes', A.n, B.n)}
          ${linha('Subidas válidas por semana — média', f1(A.taxaMedia, 2), f1(B.taxaMedia, 2), `Subidas ÷ semanas desde o 1.º scan (mín. 1). Mann–Whitney A&gt;B: ${fp(mwTaxa)}`)}
          ${linha('Subidas válidas por semana — mediana', f1(A.taxaMediana, 2), f1(B.taxaMediana, 2))}
          ${linha('Sobem em 2 ou mais dias diferentes', pct(A.dois), pct(B.dois))}
          ${linha('<strong>H1</strong> · subidas repetidas nos 7 dias após o 1.º scan — média', f1(A.rep7Media, 2), f1(B.rep7Media, 2), `Repetidas = subidas válidas nesses 7 dias, menos a primeira. Mann–Whitney A&gt;B: <strong>${fp(h1rep)}</strong>`)}
          ${linha('H1 · subidas repetidas (7 dias) — mediana', f1(A.rep7Mediana, 1), f1(B.rep7Mediana, 1))}
          ${linha('H1 · com pelo menos 1 subida repetida (7 dias)', pct(A.rep7Algum), pct(B.rep7Algum))}
          ${linha('Subidas válidas nos 7 dias após o 1.º scan — média / mediana', `${f1(A.sub7Media, 2)} / ${f1(A.sub7Mediana, 1)}`, `${f1(B.sub7Media, 2)} / ${f1(B.sub7Mediana, 1)}`, `Mann–Whitney A&gt;B: ${fp(h1sub)}`)}
        </tbody>
      </table></div>
      <p class="nota" style="margin:10px 0 0">Testes unilaterais com aproximação normal (indicativos; confirma no R/SPSS com o CSV).
        Só contam leituras dentro do período do estudo. Leituras fora do estudo: ${d.scans_fora_estudo}.</p>
    </section>

    <section class="cartao">
      <h2>Subidas válidas por semana do estudo</h2>
      <div class="tabela-scroll">${tabelaSemanas(A, B, e)}</div>
    </section>

    <section class="cartao">
      <h2>Subidas válidas por dia</h2>
      <div class="legenda" aria-hidden="true">
        <span><i style="background:var(--serie-a)"></i>A · coletivo</span>
        <span><i style="background:var(--serie-b)"></i>B · pessoal</span>
      </div>
      <div class="grafico" id="grafico">${grafico(d.diario)}<div class="dica" id="dica"></div></div>
      <details style="margin-top:10px"><summary class="ligacao-btn" style="display:inline-block">Ver tabela</summary>
        <div class="tabela-scroll"><table>
          <thead><tr><th>Dia</th><th class="n">A subidas</th><th class="n">A pessoas</th><th class="n">B subidas</th><th class="n">B pessoas</th></tr></thead>
          <tbody>${d.diario.map((x) => `<tr><td>${dataPt(x.dia)}</td><td class="n">${x.A}</td><td class="n">${x.A_pessoas}</td><td class="n">${x.B}</td><td class="n">${x.B_pessoas}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Ainda sem dias de estudo.</td></tr>'}</tbody>
        </table></div>
      </details>
    </section>

    <section class="cartao">
      <h2>Exportar (CSV anónimo)</h2>
      <p class="muted">Sem IDs reais: cada participante tem um pseudónimo (P001, P002, …).</p>
      <div class="botoes">
        <button class="btn pequeno" id="csv-part">CSV por participante</button>
        <button class="btn pequeno" id="csv-dia">CSV por dia</button>
      </div>
    </section>

    <p class="nota centro">Regras: ${d.regras.min_seg_por_andar}–${d.regras.max_seg_por_andar} s por andar ·
      intervalo de ${Math.round(d.regras.cooldown_seg / 60)} min entre subidas · atualizado às ${new Date(d.gerado_em).toLocaleTimeString('pt-PT')}</p>`;

  document.getElementById('atualizar').onclick = () => entrar(sessionStorage.getItem(CHAVE) || '');
  document.getElementById('sair').onclick = () => { sessionStorage.removeItem(CHAVE); mostrarLogin(); };
  document.getElementById('csv-part').onclick = () => descarregar('sobe-participantes.csv', csvParticipantes(d));
  document.getElementById('csv-dia').onclick = () => descarregar('sobe-diario.csv', csvDiario(d));
  ligarDicas(d.diario);
}

function tabelaSemanas(A, B, e) {
  const n = dados.estudo.semanas;
  const linhas = [];
  for (let k = 1; k <= n; k++) {
    const ini = somar(e.inicio, (k - 1) * 7);
    const fim = minStr(somar(ini, 6), e.fim);
    const stats = (G) => {
      const ativos = G.part.filter((l) => l.primeiro_dia <= fim).map((l) => l.por_semana[k - 1] ?? 0);
      return `${f1(media(ativos), 2)} / ${f1(mediana(ativos), 1)} <span class="nota">(n=${ativos.length})</span>`;
    };
    linhas.push(`<tr><td>Semana ${k}<div class="nota">${dataPt(ini)} – ${dataPt(fim)}</div></td><td class="n">${stats(A)}</td><td class="n">${stats(B)}</td></tr>`);
  }
  return `<table><thead><tr><th>Semana</th><th class="n">A · média / mediana</th><th class="n">B · média / mediana</th></tr></thead><tbody>${linhas.join('')}</tbody></table>
    <p class="nota" style="margin:8px 0 0">Por participante, contando só quem já tinha feito o 1.º scan até ao fim dessa semana.</p>`;
}

// ---------------------------------------------------------------------
// Gráfico de barras agrupadas (SVG, sem bibliotecas)
// ---------------------------------------------------------------------
function grafico(diario) {
  if (!diario.length) return '<p class="muted">O gráfico aparece quando o estudo começar.</p>';
  const W = 900, H = 260, m = { t: 12, r: 8, b: 30, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(1, ...diario.map((x) => Math.max(x.A, x.B)));
  const passo = max <= 5 ? 1 : Math.ceil(max / 4 / 5) * 5 || 1;
  const topo = Math.ceil(max / passo) * passo;
  const y = (v) => m.t + ih - (v / topo) * ih;
  const bw = iw / diario.length;
  const barra = Math.max(2, Math.min(18, (bw - 6) / 2 - 1));
  const r = Math.min(4, barra / 2);
  const coluna = (x0, v, cor) => {
    if (!v) return '';
    const yt = y(v), yb = y(0);
    return `<path d="M${x0},${yb}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + barra - r}Q${x0 + barra},${yt} ${x0 + barra},${yt + r}V${yb}Z" fill="${cor}"/>`;
  };
  let grade = '';
  for (let v = 0; v <= topo; v += passo) {
    grade += `<line class="grade" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="eixo" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const cada = Math.ceil(diario.length / 12);
  let barras = '', rotulos = '', alvos = '';
  diario.forEach((x, i) => {
    const cx = m.l + bw * i + bw / 2;
    alvos += `<rect class="alvo-hover" data-i="${i}" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${ih}" rx="6"/>`;
    barras += coluna(cx - barra - 1, x.A, 'var(--serie-a)') + coluna(cx + 1, x.B, 'var(--serie-b)');
    if (i % cada === 0) rotulos += `<text class="eixo" x="${cx}" y="${H - 10}" text-anchor="middle">${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Subidas válidas por dia, versões A e B">${grade}${alvos}<g pointer-events="none">${barras}</g>${rotulos}</svg>`;
}

function ligarDicas(diario) {
  const g = document.getElementById('grafico'), dica = document.getElementById('dica');
  if (!g || !dica) return;
  g.addEventListener('pointermove', (ev) => {
    const alvo = ev.target.closest('.alvo-hover');
    g.querySelectorAll('.alvo-hover.ativo').forEach((el) => el !== alvo && el.classList.remove('ativo'));
    if (!alvo) { dica.style.display = 'none'; return; }
    alvo.classList.add('ativo');
    const x = diario[Number(alvo.dataset.i)];
    const caixa = g.getBoundingClientRect();
    dica.innerHTML = `<strong>${dataPt(x.dia)}</strong><br><i style="background:var(--serie-a)"></i>A: ${x.A} subidas · ${x.A_pessoas} pessoas<br><i style="background:var(--serie-b)"></i>B: ${x.B} subidas · ${x.B_pessoas} pessoas`;
    dica.style.display = 'block';
    const px = Math.min(caixa.width - 110, Math.max(110, ev.clientX - caixa.left));
    dica.style.left = `${px}px`;
    dica.style.top = `${ev.clientY - caixa.top}px`;
  });
  g.addEventListener('pointerleave', () => {
    dica.style.display = 'none';
    g.querySelectorAll('.alvo-hover.ativo').forEach((el) => el.classList.remove('ativo'));
  });
}

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------
function csv(linhas) {
  const esc = (v) => (v == null ? '' : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return '﻿' + linhas.map((l) => l.map(esc).join(',')).join('\r\n');
}
function csvParticipantes(d) {
  const n = d.estudo.semanas;
  const cab = ['participante', 'variante', 'primeiro_dia', 'leituras', 'subidas_validas', 'andares',
    'dias_diferentes', 'subidas_7d', 'repetidas_7d', 'semanas_expostas', 'subidas_por_semana', 'meta_semanal',
    ...Array.from({ length: n }, (_, k) => `semana_${k + 1}`)];
  const rows = d.participantes.map((l) => [l.id, l.variante, l.primeiro_dia, l.n_scans, l.subidas, l.andares,
    l.dias, l.subidas_7d, Math.max(0, l.subidas_7d - 1), l.semanas_expostas,
    (l.subidas / Math.max(1, l.semanas_expostas)).toFixed(3), l.meta_semanal ?? '', ...l.por_semana]);
  return csv([cab, ...rows]);
}
function csvDiario(d) {
  return csv([['dia', 'A_subidas', 'A_pessoas', 'B_subidas', 'B_pessoas'],
    ...d.diario.map((x) => [x.dia, x.A, x.A_pessoas, x.B, x.B_pessoas])]);
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
