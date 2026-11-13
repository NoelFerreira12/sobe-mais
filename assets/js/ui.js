// Ícones, ilustração, confettis e componentes partilhados.
export const reduzirMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const svg = (corpo, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${corpo}</svg>`;

export const ICONES = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  pe: svg('<path d="M4 20h4v-4h4v-4h4V8h4V4"/>'),
  calendario: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  raio: svg('<path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/>'),
  elo: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  chama: svg('<path d="M12 21c-3.9 0-7-2.7-7-6.5C5 10 9 8.5 9.5 3.5 13 6 13.5 8.5 13 11c1.2-.6 2-1.8 2.2-3.2C17.6 9.6 19 12 19 14.5c0 3.8-3.1 6.5-7 6.5z"/>'),
  alvo: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'),
  relogio: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  descer: svg('<path d="M12 4v15M6 13l6 6 6-6"/>'),
  pausa: svg('<path d="M9 6v12M15 6v12"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>'),
  subir: svg('<path d="M12 20V5M6 11l6-6 6 6"/>'),
  bandeira: svg('<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>'),
  qr: svg('<rect x="3.5" y="3.5" width="6" height="6" rx="1.2"/><rect x="14.5" y="3.5" width="6" height="6" rx="1.2"/><rect x="3.5" y="14.5" width="6" height="6" rx="1.2"/><path d="M14.5 14.5h2.5v2.5M20.5 14.5v.1M14.5 20.5h.1M17.5 20.5h3v-3"/>', 'class="ico"'),
  repetir: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5"/>'),
};

export const LOGO = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 27L12.5 13.5 16.5 18.5 22 9.5 29 27z"/><path d="M22 9.5V3l5 2-5 2"/></svg>`;

// Montanha com degraus e bandeira no topo, em linha laranja.
export const MONTANHA = `<svg class="montanha" viewBox="0 0 200 140" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Montanha com degraus e uma bandeira no topo">
  <path d="M6 130L68 52l22 24 38-52 66 106" stroke-width="5"/>
  <path d="M4 130h192" stroke-width="5"/>
  <path d="M64 130v-10h8v-10h8v-10h8V90h8V80h8V70h8V60h8V50h8" stroke-width="4"/>
  <path d="M128 24V4" stroke-width="4"/>
  <path d="M128 4l20 6-20 6z" stroke-width="4" fill="currentColor" fill-opacity=".25"/>
  <path d="M30 32h14M150 46h22" stroke-width="3" opacity=".45"/>
</svg>`;

export function cabecalho(raiz = '') {
  return `<header class="barra-topo">
    <a class="logo" href="${raiz}./" aria-label="Sobe+ — início">${LOGO}<span>Sobe<span class="mais">+</span></span></a>
    <span class="etiqueta">UMa</span>
  </header>`;
}

export function rodape(raiz = '') {
  return `<nav class="rodape" aria-label="Ligações">
    <a href="${raiz}./">Sobre</a> · <a href="${raiz}privacidade/">Privacidade</a> · <a href="${raiz}termos/">Termos</a>
    <div style="margin-top:6px">Sobe+ · Persuasive Computing · Universidade da Madeira</div>
  </nav>`;
}

export const fmt = (n, casas = 0) =>
  Number(n).toLocaleString('pt-PT', { maximumFractionDigits: casas, minimumFractionDigits: 0 });

export const nomePiso = (p) => `Piso ${p}`;

/** Frase que compara a escada com a espera pelo elevador (valores em config.js). */
export function fraseComparacao(CONFIG, andares = 2) {
  const escada = CONFIG.tempoEscadaPorAndarSeg * andares;
  return `Subir ${andares} andares pela escada leva cerca de ${duracao(escada)}, ` +
    `muitas vezes menos do que esperar pelo elevador (cerca de ${duracao(CONFIG.esperaElevadorSeg)}).`;
}

export function duracao(seg) {
  // espaços não separáveis: "30 s" nunca parte a meio da linha
  if (seg < 60) return `${Math.round(seg)} s`;
  const m = Math.floor(seg / 60), s = Math.round(seg % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function vibrar(padrao = [30, 50, 30]) {
  try { navigator.vibrate?.(padrao); } catch { /* */ }
}

/** Anima um número de 0 até ao valor final. */
export function contar(el, ate, casas = 0, ms = 1100) {
  if (!el) return;
  if (reduzirMovimento()) { el.textContent = fmt(ate, casas); return; }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(ate * (1 - (1 - k) ** 3), casas);
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/** Confettis leves (desligados com prefers-reduced-motion). */
export function confettis() {
  if (reduzirMovimento()) return;
  const c = document.createElement('canvas');
  c.className = 'confettis';
  document.body.appendChild(c);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const cores = ['#D84718', '#F07A45', '#F6B78F', '#323232', '#FFD27A'];
  const p = Array.from({ length: 70 }, () => ({
    x: W / 2 + (Math.random() - .5) * 80, y: H * .32,
    vx: (Math.random() - .5) * 9, vy: -Math.random() * 9 - 4,
    r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
    w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, cor: cores[(Math.random() * cores.length) | 0],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    const k = (t - t0) / 1800;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    for (const q of p) {
      q.vy += .28; q.vx *= .99; q.x += q.vx; q.y += q.vy; q.r += q.vr;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.r);
      ctx.fillStyle = q.cor; ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h); ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- Cartões comuns às duas variantes ----------
/** Meta semanal (compromisso) + sequência de semanas, num só cartão. */
export function cartaoSemana(r) {
  const opcoes = [1, 2, 3, 4, 5];
  const chips = (marcar) => opcoes.map((n) =>
    `<button class="chip" data-meta="${n}" aria-pressed="${n === marcar}">${n}×</button>`).join('');
  let meta;
  if (!r.meta) {
    meta = `<p class="muted" style="margin:0 0 10px">Meta opcional: quantas vezes por semana te comprometes a subir?</p>
      <div class="chips" role="group" aria-label="Meta semanal">${chips(null)}</div>`;
  } else {
    const feitos = Math.min(r.estaSemana, r.meta);
    const pontos = Array.from({ length: r.meta }, (_, i) => `<i class="${i < feitos ? 'cheio' : ''}"></i>`).join('');
    const msg = r.estaSemana >= r.meta ? 'Meta cumprida. Palavra dada!' : `Faltam ${r.meta - r.estaSemana}. Ao teu ritmo.`;
    meta = `<div class="semana-linha"><span>Meta: <strong>${r.meta}× por semana</strong></span>
        <span class="num" style="font-size:1.6rem">${r.estaSemana}/${r.meta}</span></div>
      <div class="pontos" aria-hidden="true">${pontos}</div>
      <p class="muted pequeno" style="margin:4px 0 0">${msg}</p>
      <details style="margin-top:4px"><summary class="ligacao-btn" style="padding:4px 0;min-height:0">Mudar a meta</summary>
        <div class="chips" role="group" aria-label="Meta semanal" style="margin-top:8px">${chips(r.meta)}
          <button class="chip" data-meta="0" aria-pressed="false">Sem meta</button></div>
      </details>`;
  }
  let seqTxt;
  if (r.sequencia === 0) seqTxt = 'Sobe em semanas seguidas para começar. Podes falhar 1 semana sem perder.';
  else if (r.emPausa) seqTxt = 'Semana de pausa: não faz mal. Sobe esta semana para manter.';
  else seqTxt = 'Podes falhar 1 semana sem perder a sequência.';
  return `<section class="cartao" id="meta">
    <h2>Esta semana</h2>
    ${meta}
    <div class="divisor"></div>
    <div class="semana-linha"><span>Sequência</span>
      <span class="num" style="font-size:1.4rem;color:var(--laranja-texto)">${r.sequencia} ${r.sequencia === 1 ? 'semana' : 'semanas'}</span></div>
    <p class="muted pequeno" style="margin:2px 0 0">${seqTxt}</p>
  </section>`;
}

export function cartaoMedalhas(r, novas = new Set()) {
  return `<section class="cartao">
    <h2>Medalhas</h2>
    <p class="muted pequeno">Premiamos a regularidade, não a quantidade.</p>
    <div class="medalhas">
      ${r.medalhas.map((m) => `<div class="medalha ${m.ganha ? 'ganha' : ''} ${novas.has(m.id) ? 'nova' : ''}">
        <div class="disco">${ICONES[m.icone]}</div>
        <b>${m.nome}</b><small>${m.desc}</small>
        <span class="sr">${m.ganha ? 'Conquistada' : 'Por conquistar'}</span>
      </div>`).join('')}
    </div>
  </section>`;
}

/** Devolve as medalhas ganhas desde a última vez neste dispositivo. */
export function medalhasNovas(r) {
  const ganhas = r.medalhas.filter((m) => m.ganha).map((m) => m.id);
  let antes = [];
  try { antes = JSON.parse(localStorage.getItem('sobe_medalhas') || '[]'); } catch { /* */ }
  try { localStorage.setItem('sobe_medalhas', JSON.stringify(ganhas)); } catch { /* */ }
  return new Set(ganhas.filter((g) => !antes.includes(g)));
}
