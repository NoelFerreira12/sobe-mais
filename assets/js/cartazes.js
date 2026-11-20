import { CONFIG } from '../../config.js?v=202611201111';
import { rpc } from './api.js?v=202611201111';
import * as ui from './ui.js?v=202611201111';

const controlo = document.getElementById('controlo');
const folhas = document.getElementById('folhas');
const CHAVE = 'sobe_painel';
const DIRECOES = { '→': 0, '↘': 45, '↓': 90, '↙': 135, '←': 180, '↖': 225, '↑': 270, '↗': 315 };

/** QR em SVG (correção de erro M) a partir do gerador qrcode-generator. */
export function qrSvg(texto, margem = 3) {
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount(), t = n + margem * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) d += `M${c + margem},${r + margem}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function instrucao(piso) {
  const min = Math.min(...CONFIG.pisos), max = Math.max(...CONFIG.pisos);
  if (piso === min) return 'Lê aqui antes de subir';
  if (piso === max) return 'Lê aqui quando chegares ao topo';
  return 'Lê aqui ao chegar e antes de continuar a subir';
}

const seta = (graus) => `<svg class="seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${graus}deg)" aria-hidden="true"><path d="M3 12h17M13 5l7 7-7 7"/></svg>`;

function lerDirecoes() { try { return JSON.parse(localStorage.getItem('sobe_setas') || '{}'); } catch { return {}; } }
function guardarDirecao(piso, dir) {
  const d = lerDirecoes(); d[piso] = dir;
  try { localStorage.setItem('sobe_setas', JSON.stringify(d)); } catch { /* */ }
}

function cartaz(p, dir) {
  const url = `${CONFIG.siteUrl}/s/?p=${encodeURIComponent(p.token)}`;
  const fixo = (seg) => `cerca de ${ui.duracao(seg)}`.replace(/ /g, ' ');
  const escada = CONFIG.tempoEscadaPorAndarSeg, elev = CONFIG.esperaElevadorSeg;
  return `<div class="escala" data-piso="${p.piso}">
    <div class="direcoes" role="group" aria-label="Direção da seta para o Piso ${p.piso}">
      <strong style="margin-right:6px">Piso ${p.piso} · seta:</strong>
      ${Object.keys(DIRECOES).map((k) => `<button class="chip" data-piso="${p.piso}" data-dir="${k}" aria-pressed="${k === dir}">${k}</button>`).join('')}
    </div>
    <article class="cartaz">
      <div class="faixa">
        <div class="marca">${ui.LOGO}<span>Sobe+</span></div>
        <div class="uma">Universidade<br>da Madeira</div>
      </div>
      <div class="corpo">
        <h1 class="piso">Piso ${p.piso}</h1>
        <p class="instrucao">${instrucao(p.piso)}</p>
        <div class="qr">${qrSvg(url)}</div>
        <p class="aponta">Aponta a câmara do telemóvel. Sem app e sem conta.</p>
        <div class="escadas">${seta(DIRECOES[dir])}<span>Escadas</span></div>
      </div>
      <div class="info">
        <p>Subir 1 andar a pé: <strong>${fixo(escada)}</strong>. Esperar pelo elevador: <strong>${fixo(elev)}</strong>.</p>
        <p>A OMS recomenda 150 minutos de atividade física moderada por semana.</p>
        <p style="font-size:4mm;color:#5C554F">Participação voluntária e anónima. Se precisas do elevador, usa-o sem hesitar.</p>
      </div>
      <div class="pe"><span>Lê o QR do piso onde começas e do piso onde chegas.</span><span class="codigo">${p.codigo} · Piso ${p.piso}</span></div>
    </article>
  </div>`;
}

function ajustarEscala() {
  const disponivel = Math.min(window.innerWidth - 32, 820);
  const mm = 96 / 25.4;
  const z = Math.min(1, disponivel / (210 * mm));
  document.querySelectorAll('.cartaz').forEach((el) => { el.style.zoom = z; });
}

let pisos = [];
function desenhar() {
  const dirs = lerDirecoes();
  folhas.innerHTML = pisos.map((p) => cartaz(p, dirs[p.piso] || '→')).join('');
  ajustarEscala();
}

function mostrarLogin(erro = '') {
  controlo.innerHTML = `${ui.cabecalho('../')}
    <section class="cartao" style="max-width:440px;margin:24px auto">
      <h1>Cartazes para imprimir</h1>
      <p class="muted">Os QR são secretos: entra com a password do painel.</p>
      <form id="login" class="pilha">
        <label for="pw"><strong>Password</strong></label>
        <input type="password" id="pw" required autocomplete="current-password">
        ${erro ? `<p class="aviso-caixa" role="alert" style="margin:0">${erro}</p>` : ''}
        <button class="btn" type="submit">Ver cartazes</button>
      </form>
    </section>`;
  document.getElementById('login').addEventListener('submit', (e) => { e.preventDefault(); entrar(document.getElementById('pw').value); });
}

async function entrar(pw) {
  let r;
  try { r = await rpc('pisos_qr', { p_password: pw }); } catch (e) { console.error(e); return mostrarLogin('Sem ligação ao servidor.'); }
  if (!r.ok) { try { sessionStorage.removeItem(CHAVE); } catch { /* */ } return mostrarLogin(r.erro === 'bloqueado' ? 'Demasiadas tentativas. Espera 15 minutos.' : 'Password incorreta.'); }
  try { sessionStorage.setItem(CHAVE, pw); } catch { /* */ }
  pisos = r.pisos;
  controlo.innerHTML = `${ui.cabecalho('../')}
    <section class="cartao" style="margin-top:8px">
      <h1>Cartazes para imprimir</h1>
      <p>7 cartazes A4, um por piso. Escolhe a direção da seta de cada um (para onde ficam as escadas) e imprime.</p>
      <p class="muted pequeno">Na janela de impressão: papel A4, margens "Nenhuma", escala 100% e ativa "Gráficos de fundo".
        Testa um QR com o telemóvel antes de colar.</p>
      <button class="btn" onclick="window.print()">Imprimir 7 cartazes</button>
    </section>`;
  desenhar();
}

folhas.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-dir]');
  if (!b) return;
  guardarDirecao(b.dataset.piso, b.dataset.dir);
  desenhar();
});
addEventListener('resize', ajustarEscala);
addEventListener('beforeprint', () => document.querySelectorAll('.cartaz').forEach((el) => { el.style.zoom = 1; }));
addEventListener('afterprint', ajustarEscala);

const guardada = (() => { try { return sessionStorage.getItem(CHAVE); } catch { return null; } })();
if (guardada) entrar(guardada); else mostrarLogin();
