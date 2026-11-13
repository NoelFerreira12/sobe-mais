import { CONFIG } from '../../config.js';
import { rpc } from './api.js';
import { lerId, criarId } from './id.js';
import { resumo, metros, metrosSubida, progressoMontanha } from './calc.js';
import * as ui from './ui.js';
import { lerQR } from './leitor.js';

const botaoLer = (txt = 'Ler QR do piso', cls = '') =>
  `<button class="btn ${cls}" type="button" data-ler>${ui.ICONES.qr}<span>${txt}</span></button>`;

const ecra = document.getElementById('ecra');
document.getElementById('topo').innerHTML = ui.cabecalho('../');

const PEND = 'sobe_pendente';
let estadoAtual = null;
let userId = null;

// ---------------------------------------------------------------------
// Arranque: o token sai logo do URL (recarregar a página não conta como novo scan).
// ---------------------------------------------------------------------
function tokenDoPedido() {
  const p = new URLSearchParams(location.search).get('p');
  if (p) {
    try { sessionStorage.setItem(PEND, JSON.stringify({ token: p, t: Date.now() })); } catch { /* */ }
    history.replaceState(null, '', location.pathname);
    return p;
  }
  try {
    const pend = JSON.parse(sessionStorage.getItem(PEND) || 'null');
    if (pend && Date.now() - pend.t < 120000) return pend.token;
  } catch { /* */ }
  return null;
}
const limparPendente = () => { try { sessionStorage.removeItem(PEND); } catch { /* */ } };

function arrancar() {
  const params = new URLSearchParams(location.search);
  const abrirCamara = params.get('ler') === '1' && !params.get('p');
  if (abrirCamara) history.replaceState(null, '', location.pathname);
  const token = tokenDoPedido();
  userId = lerId();
  if (token && !userId) return mostrarConsentimento(token);
  if (token) return registar(token);
  if (abrirCamara) setTimeout(abrirLeitor, 0);
  if (userId) return mostrarEstado();
  return mostrarSemId();
}

// Leitura do QR dentro da app: o token lido segue exatamente o mesmo caminho
// que um QR aberto pela câmara do telemóvel (validação toda no servidor).
async function abrirLeitor() {
  let token;
  try {
    token = await lerQR();
  } catch (e) {
    return mostrarErroCamara(e.message);
  }
  if (!token) return;
  userId = lerId();
  if (!userId) return mostrarConsentimento(token);
  registar(token);
}

function mostrarErroCamara(codigo) {
  const negado = codigo === 'camara_negada';
  ecra.innerHTML = `
    <section class="cartao resultado aviso aparecer">
      <div class="icone">${ui.ICONES.info}</div>
      <h1>Não conseguimos abrir a câmara</h1>
      <p>${negado
        ? 'Dá permissão à câmara nas definições do browser e tenta outra vez.'
        : 'Este browser não deixa usar a câmara aqui.'}
        Também podes ler o QR com a app da câmara do telemóvel: conta da mesma forma.</p>
      ${botaoLer('Tentar outra vez')}
    </section>
    <p class="centro" style="margin-top:16px"><a href="./">Ver o meu progresso</a></p>`;
}

// ---------------------------------------------------------------------
// Ecrãs
// ---------------------------------------------------------------------
function mostrarConsentimento(token) {
  ecra.innerHTML = `
    <div class="hero aparecer"><div class="ilustracao">${ui.MONTANHA}</div>
      <h1>Bem-vindo ao Sobe<span style="color:var(--laranja)">+</span></h1>
      <p>Troca o elevador pela escada sempre que puderes. Sem app e sem conta.</p></div>
    <section class="cartao aparecer aparecer-2">
      <h2>Antes de começar</h2>
      <p><strong>Registamos um ID anónimo e a hora a que lês os QR, só para contar subidas.</strong></p>
      <p class="muted pequeno">Não pedimos nome, email, número de aluno, localização nem dados de saúde.
        Participar é voluntário e, se precisares do elevador, usa-o sem hesitar.</p>
      <button class="btn" id="aceitar">Aceitar e começar</button>
      <p class="centro" style="margin:12px 0 0"><a href="../#etica">Saber mais</a></p>
    </section>`;
  document.getElementById('aceitar').addEventListener('click', () => {
    userId = criarId();
    registar(token);
  });
}

function mostrarSemId() {
  ecra.innerHTML = `
    <div class="hero aparecer"><div class="ilustracao">${ui.MONTANHA}</div>
      <h1>Sobe<span style="color:var(--laranja)">+</span></h1>
      <p>Para participar, lê um dos QR do Sobe+ que estão junto às escadas.</p></div>
    <div class="aparecer aparecer-2" style="margin-bottom:14px">${botaoLer()}</div>
    <section class="cartao destaque aparecer aparecer-2"><p style="margin:0">${ui.fraseComparacao(CONFIG)}</p></section>
    <p class="centro" style="margin-top:20px"><a href="../">Como funciona</a></p>`;
}

function carregar(txt = 'A registar…') {
  ecra.innerHTML = `<div class="carregar"><div class="roda"></div><span>${txt}</span></div>`;
}

async function registar(token) {
  carregar();
  let r;
  try {
    r = await rpc('registar_scan', { p_user_id: userId, p_token: token });
  } catch (e) {
    console.error(e);
    return mostrarErroRede(token);
  }
  limparPendente();
  if (!r.ok) return mostrarErro(r.erro);
  estadoAtual = r.estado;
  mostrarResultado(r);
}

function mostrarErroRede(token) {
  ecra.innerHTML = `
    <section class="cartao resultado aviso aparecer">
      <div class="icone">${ui.ICONES.info}</div>
      <h1>Sem ligação</h1>
      <p>Não conseguimos registar a leitura. Verifica a internet e tenta outra vez.</p>
      <button class="btn" id="repetir">Tentar outra vez</button>
    </section>`;
  document.getElementById('repetir').addEventListener('click', () => registar(token));
}

const ERROS = {
  qr_invalido: ['Este QR não é válido', 'Lê um dos QR do Sobe+ que estão junto às escadas.'],
  muito_seguido: ['Um de cada vez', 'Espera uns segundos antes de ler outro QR.'],
  limite: ['Muitas leituras seguidas', 'Fizeste muitas leituras na última hora. Tenta mais tarde.'],
  pedido_invalido: ['Algo correu mal', 'Tenta ler o QR outra vez.'],
};

function mostrarErro(codigo) {
  const [t, p] = ERROS[codigo] ?? ERROS.pedido_invalido;
  ecra.innerHTML = `
    <section class="cartao resultado aviso aparecer">
      <div class="icone">${ui.ICONES.info}</div><h1>${t}</h1><p>${p}</p>
      ${botaoLer('Ler outro QR')}
    </section>
    <p class="centro" style="margin-top:16px"><a href="./">Ver o meu progresso</a></p>`;
}

function textoResultado(r) {
  const P = ui.nomePiso;
  switch (r.resultado) {
    case 'inicio':
      if (r.piso === Math.max(...CONFIG.pisos)) {
        return { cls: '', icone: 'bandeira', titulo: `Estás no topo, ${P(r.piso)}!`,
          texto: 'Para a próxima subida, lê o QR do piso onde começares.' };
      }
      return { cls: '', icone: 'subir', titulo: `Começaste no ${P(r.piso)}!`,
        texto: 'Sobe e lê o QR quando chegares.',
        extra: 'Ao teu ritmo: não há pressa nenhuma.' };
    case 'valida':
      return { cls: 'ok', icone: 'check', titulo: 'Subida registada!',
        grande: `+${r.andares} ${r.andares === 1 ? 'andar' : 'andares'}`,
        texto: `Do ${P(r.piso_origem)} ao ${P(r.piso)}.` };
    case 'rapido':
      return { cls: 'aviso', icone: 'relogio', titulo: 'Foste rápido demais',
        texto: `Para contar, ${r.andares} ${r.andares === 1 ? 'andar tem' : 'andares têm'} de demorar pelo menos ${ui.duracao(r.min_seg)}. Sobe com calma, ao teu ritmo.`,
        extra: `O ${P(r.piso)} fica como ponto de partida.` };
    case 'lento':
      return { cls: 'aviso', icone: 'relogio', titulo: 'Passou muito tempo',
        texto: 'Começa outra vez a partir deste piso.',
        extra: `O ${P(r.piso)} já conta como novo ponto de partida.` };
    case 'descer':
      return { cls: '', icone: 'descer', titulo: 'Descer não conta, mas boa caminhada!',
        texto: `O ${P(r.piso)} fica como ponto de partida para a próxima subida.` };
    case 'cooldown': {
      const min = Math.max(1, Math.ceil((r.cooldown_restante_seg ?? 60) / 60));
      return { cls: 'aviso', icone: 'pausa', titulo: 'Já contámos uma subida há pouco',
        texto: `Volta daqui a uns minutos (cerca de ${min} min).`,
        extra: `O ${P(r.piso)} fica como ponto de partida.` };
    }
    case 'repetido':
      return { cls: '', icone: 'repetir', titulo: 'Este QR já foi lido agora mesmo',
        texto: 'Não precisas de o ler outra vez.' };
    default:
      return { cls: 'aviso', icone: 'info', titulo: 'Leitura registada', texto: '' };
  }
}

function mostrarResultado(r) {
  const t = textoResultado(r);
  let variante = '';
  if (r.resultado === 'valida') {
    // A ÚNICA diferença entre versões. O servidor só envia "coletivo" à versão A
    // e "pessoal" à versão B.
    if (r.coletivo) variante = cartaoColetivo(r.coletivo, metrosSubida(r.piso_origem, r.piso));
    else if (r.pessoal) variante = cartaoPessoal(r.pessoal);
  }
  ecra.innerHTML = `
    <section class="cartao resultado ${t.cls} aparecer">
      <div class="icone">${ui.ICONES[t.icone]}</div>
      <h1>${t.titulo}</h1>
      ${t.grande ? `<div class="grande num">${t.grande}</div>` : ''}
      ${t.texto ? `<p>${t.texto}</p>` : ''}
      ${t.extra ? `<p class="pequeno" style="margin:0">${t.extra}</p>` : ''}
    </section>
    <div class="aparecer" style="margin-top:14px">${r.resultado === 'inicio' && t.icone !== 'bandeira'
      ? botaoLer('Ler o QR quando chegares')
      : botaoLer('Ler o próximo QR', 'secundario')}</div>
    ${variante ? `<div class="aparecer aparecer-2" style="margin-top:14px">${variante}</div>` : ''}
    <div id="comum" class="pilha aparecer aparecer-3" style="margin-top:14px"></div>`;
  desenharComum();
  animar();
  if (r.resultado === 'valida') {
    ui.vibrar();
    setTimeout(ui.confettis, 250);
  } else if (r.resultado === 'inicio') {
    ui.vibrar(25);
  }
}

async function mostrarEstado() {
  carregar('A carregar…');
  try {
    estadoAtual = await rpc('estado_utilizador', { p_user_id: userId });
  } catch (e) {
    console.error(e);
    ecra.innerHTML = `<section class="cartao resultado aviso"><div class="icone">${ui.ICONES.info}</div>
      <h1>Sem ligação</h1><p>Não conseguimos carregar o teu progresso.</p>
      <button class="btn" onclick="location.reload()">Tentar outra vez</button></section>`;
    return;
  }
  if (!estadoAtual.existe) return mostrarSemId();
  const u = estadoAtual.ultimo_scan;
  const maxTopo = Math.max(...CONFIG.pisos);
  const emCurso = u && u.piso < maxTopo &&
    u.segundos_desde <= CONFIG.maxSegPorAndar * (maxTopo - u.piso);
  const aviso = emCurso
    ? `<h2>Estás a meio de uma subida</h2><p style="margin:0">Começaste no ${ui.nomePiso(u.piso)} há ${ui.duracao(u.segundos_desde)}. Sobe e lê o QR quando chegares.</p>`
    : `<h2>Pronto para subir?</h2><p style="margin:0">Lê o QR do piso onde estás para começar uma subida.</p>`;
  ecra.innerHTML = `
    <section class="cartao destaque aparecer">${aviso}</section>
    <div class="aparecer" style="margin-top:14px">${botaoLer()}</div>
    <div id="comum" class="pilha aparecer aparecer-2" style="margin-top:14px"></div>
    <p class="muted centro pequeno" style="margin-top:18px">${ui.fraseComparacao(CONFIG)}</p>`;
  desenharComum();
}

// ---------------------------------------------------------------------
// Versão A: progresso coletivo da UMa até ao Pico Ruivo
// ---------------------------------------------------------------------
function cartaoColetivo(c, minhaSubidaM) {
  const total = metros(c.lancos);
  const p = progressoMontanha(total);
  const antes = progressoMontanha(Math.max(0, total - minhaSubidaM));
  const chegouAoTopo = p.voltas > antes.voltas;
  const topo = CONFIG.topo;
  const pctInicial = antes.voltas === p.voltas ? antes.pct : 0;
  const marcos = CONFIG.marcos
    .filter((m) => m.altitude < topo.altitude)
    .map((m) => `<i style="left:${(m.altitude / topo.altitude) * 100}%" title="${m.nome}"></i>`).join('');
  const lista = CONFIG.marcos.map((m) => {
    const cls = m.altitude <= p.atual ? 'feito' : (m === p.proximo ? 'proximo' : '');
    return `<li class="${cls}"><span>${m.nome}</span><span class="num" style="font-weight:700">${ui.fmt(m.altitude)} m</span></li>`;
  }).join('');
  const proximoTxt = p.proximo.altitude === topo.altitude
    ? `Próximo marco: <strong>${topo.nome}</strong>, o topo. Faltam <strong>${ui.fmt(p.falta)} m</strong>.`
    : `Próximo marco: <strong>${p.proximo.nome}</strong> (${ui.fmt(p.proximo.altitude)} m). Faltam <strong>${ui.fmt(p.falta)} m</strong>.`;
  return `<section class="cartao destaque" data-variante-ecra="A">
    <span class="etiqueta">A UMa a subir o ${topo.nome}</span>
    ${chegouAoTopo ? `<p style="margin:10px 0 4px"><span class="selo">${ui.ICONES.bandeira.replace('<svg', '<svg width="18" height="18"')} Chegámos ao ${topo.nome}!</span></p>` : ''}
    ${p.voltas >= 1 ? `<p style="margin:8px 0 0"><strong>${p.subidaN}.ª subida ao ${topo.nome}.</strong> A contagem recomeçou.</p>` : ''}
    <div style="margin:10px 0 12px"><span class="metros-grande num" data-contar="${p.atual}">0</span>
      <span class="muted"> m de ${ui.fmt(topo.altitude)} m</span></div>
    <div class="barra" role="progressbar" aria-label="Progresso da UMa até ao ${topo.nome}"
      aria-valuemin="0" aria-valuemax="${topo.altitude}" aria-valuenow="${Math.round(p.atual)}">
      <span data-de="${pctInicial * 100}" data-ate="${p.pct * 100}"></span></div>
    <div class="marcos" aria-hidden="true">${marcos}</div>
    <p style="margin:0 0 6px">${proximoTxt}</p>
    <p class="muted pequeno" style="margin:0">A tua subida juntou-se a ${ui.fmt(c.subidas)} ${c.subidas === 1 ? 'subida' : 'subidas'} de ${ui.fmt(c.pessoas)} ${c.pessoas === 1 ? 'pessoa' : 'pessoas'} da UMa${p.voltas ? `: ${ui.fmt(total)} m no total` : ''}.</p>
    <ul class="lista-marcos">${lista}</ul>
  </section>`;
}

// ---------------------------------------------------------------------
// Versão B: só o contador pessoal
// ---------------------------------------------------------------------
function cartaoPessoal(pe) {
  const m = metros(pe.lancos);
  return `<section class="cartao destaque" data-variante-ecra="B">
    <span class="etiqueta">O teu contador</span>
    <div class="numeros" style="margin-top:12px">
      <div><div class="valor num" data-contar="${pe.subidas}">0</div><div class="rotulo">${pe.subidas === 1 ? 'subida' : 'subidas'}</div></div>
      <div><div class="valor num" data-contar="${pe.andares}">0</div><div class="rotulo">${pe.andares === 1 ? 'andar' : 'andares'}</div></div>
      <div><div class="valor num" data-contar="${m}">0</div><div class="rotulo">${m === 1 ? 'metro' : 'metros'}</div></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------
// Partes comuns às duas versões (meta, sequência, medalhas)
// ---------------------------------------------------------------------
function desenharComum() {
  const alvo = document.getElementById('comum');
  if (!alvo || !estadoAtual?.existe) return;
  const r = resumo(estadoAtual);
  const novas = ui.medalhasNovas(r);
  alvo.innerHTML = ui.cartaoMeta(r) + ui.cartaoSequencia(r) + ui.cartaoMedalhas(r, novas);
}

function animar() {
  document.querySelectorAll('[data-contar]').forEach((el) => ui.contar(el, Number(el.dataset.contar)));
  document.querySelectorAll('.barra > span[data-ate]').forEach((el) => {
    el.style.width = `${el.dataset.de}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = `${el.dataset.ate}%`; }));
  });
}

ecra.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-ler]')) abrirLeitor();
});

ecra.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-meta]');
  if (!b || !userId) return;
  const meta = Number(b.dataset.meta) || null;
  b.disabled = true;
  try {
    const r = await rpc('definir_meta', { p_user_id: userId, p_meta: meta });
    if (r.ok) { estadoAtual.meta_semanal = r.meta_semanal; desenharComum(); }
  } catch (e) {
    console.error(e);
    b.disabled = false;
  }
});

arrancar();
