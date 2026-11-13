import { CONFIG } from '../../config.js';
import { rpc } from './api.js';
import { lerId, definirId, esquecerId } from './id.js';
import { resumo, metros, metrosSubida, progressoRota } from './calc.js';
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
  if (token && !userId) return mostrarConta(token);
  if (token) return registar(token);
  if (abrirCamara) setTimeout(abrirLeitor, 0);
  if (userId) return mostrarEstado();
  return mostrarConta(null);
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
  if (!userId) return mostrarConta(token);
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
// ---------------------------------------------------------------------
// Conta: cada utilizador entra com nome de utilizador + palavra-passe (sem email).
// O token lido (se houver) fica à espera e é registado logo a seguir ao login.
// ---------------------------------------------------------------------
const ERROS_CONTA = {
  utilizador_invalido: 'O nome tem de ter 3 a 24 caracteres: letras minúsculas, números, ponto, hífen ou _.',
  password_curta: 'A palavra-passe tem de ter pelo menos 6 caracteres.',
  utilizador_existe: 'Esse nome já está a ser usado. Escolhe outro ou entra na tua conta.',
  credenciais: 'Nome ou palavra-passe incorretos.',
  bloqueado: 'Demasiadas tentativas falhadas. Espera 15 minutos.',
  muitas_contas: 'Muitas contas criadas agora mesmo. Tenta daqui a pouco.',
};

function mostrarConta(token, modo = 'criar', erro = '', nome = '') {
  const criar = modo === 'criar';
  ecra.innerHTML = `
    <div class="hero aparecer" style="padding-bottom:0"><div class="ilustracao" style="width:min(170px,50%)">${ui.MONTANHA}</div>
      <h1>${token ? 'Quase lá!' : `Sobe<span style="color:var(--laranja)">+</span>`}</h1>
      <p>${token ? 'Entra ou cria a tua conta para esta leitura contar.' : 'Entra ou cria a tua conta para participar.'}</p></div>
    <section class="cartao aparecer aparecer-2">
      <div class="separadores" role="tablist" aria-label="Conta">
        <button type="button" role="tab" data-modo="criar" aria-selected="${criar}">Criar conta</button>
        <button type="button" role="tab" data-modo="entrar" aria-selected="${!criar}">Já tenho conta</button>
      </div>
      <form id="form-conta" class="pilha" novalidate>
        <div>
          <label for="u"><strong>Nome de utilizador</strong></label>
          <input type="text" id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off"
            spellcheck="false" minlength="3" maxlength="24" required value="${nome.replace(/[^a-z0-9._-]/gi, '')}">
          ${criar ? '<p class="muted pequeno" style="margin:6px 0 0">Usa uma alcunha. Não uses o teu nome verdadeiro nem o número de aluno.</p>' : ''}
        </div>
        <div>
          <label for="pw"><strong>Palavra-passe</strong></label>
          <input type="password" id="pw" name="password" autocomplete="${criar ? 'new-password' : 'current-password'}" minlength="6" maxlength="72" required>
          ${criar ? '<p class="muted pequeno" style="margin:6px 0 0">Mínimo 6 caracteres. Não pedimos email, por isso guarda-a bem.</p>' : ''}
        </div>
        ${criar ? `<div class="aviso-caixa">
          <p style="margin:0"><strong>Registamos um ID anónimo e a hora a que lês os QR, só para contar subidas.</strong></p>
          <p class="pequeno" style="margin:6px 0 0">Não pedimos email, número de aluno, localização nem dados de saúde.
            Participar é voluntário e, se precisares do elevador, usa-o sem hesitar. <a href="../#etica">Saber mais</a></p>
        </div>` : ''}
        ${erro ? `<p class="aviso-caixa" role="alert" style="margin:0">${erro}</p>` : ''}
        <button class="btn" type="submit">${criar ? 'Aceitar e criar conta' : 'Entrar'}</button>
      </form>
    </section>
    ${token ? '' : `<p class="muted centro pequeno" style="margin-top:16px">${ui.fraseComparacao(CONFIG)}</p>`}`;

  ecra.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    mostrarConta(token, b.dataset.modo, '', document.getElementById('u').value);
  }));
  document.getElementById('form-conta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const u = document.getElementById('u').value.trim().toLowerCase();
    const pw = document.getElementById('pw').value;
    const btn = ev.submitter || ev.target.querySelector('button[type=submit]');
    btn.disabled = true;
    let r;
    try {
      r = await rpc(criar ? 'criar_conta' : 'entrar', { p_utilizador: u, p_password: pw });
    } catch (e) {
      console.error(e);
      return mostrarConta(token, modo, 'Sem ligação ao servidor. Tenta outra vez.', u);
    }
    if (!r.ok) return mostrarConta(token, modo, ERROS_CONTA[r.erro] ?? 'Algo correu mal. Tenta outra vez.', u);
    definirId(r.user_id, r.utilizador);
    userId = r.user_id;
    if (token) registar(token); else mostrarEstado();
  });
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
  if (!r.ok && r.erro === 'sem_conta') {
    esquecerId(); userId = null;
    return mostrarConta(token, 'entrar', 'A tua sessão terminou. Entra outra vez para esta leitura contar.');
  }
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
    const estaSubida = metrosSubida(r.piso_origem, r.piso);
    if (r.coletivo) variante = cartaoColetivo(r.coletivo, estaSubida);
    else if (r.pessoal) variante = cartaoPessoal(r.pessoal, estaSubida);
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
  if (!estadoAtual.conta) {
    esquecerId(); userId = null;
    return mostrarConta(null, 'entrar', 'A tua sessão terminou. Entra outra vez.');
  }
  const u = estadoAtual.ultimo_scan;
  const maxTopo = Math.max(...CONFIG.pisos);
  const emCurso = u && u.piso < maxTopo &&
    u.segundos_desde <= CONFIG.maxSegPorAndar * (maxTopo - u.piso);
  const aviso = emCurso
    ? `<h2>Estás a meio de uma subida</h2><p style="margin:0">Começaste no ${ui.nomePiso(u.piso)} há ${ui.duracao(u.segundos_desde)}. Sobe e lê o QR quando chegares.</p>`
    : `<h2>Pronto para subir?</h2><p style="margin:0">Lê o QR do piso onde estás para começar uma subida.</p>`;
  const nome = String(estadoAtual.utilizador || '').replace(/[^a-z0-9._-]/g, '');
  ecra.innerHTML = `
    <p class="ola aparecer">Olá, <strong>${nome}</strong></p>
    <section class="cartao destaque aparecer">${aviso}</section>
    <div class="aparecer" style="margin-top:14px">${botaoLer()}</div>
    <div id="comum" class="pilha aparecer aparecer-2" style="margin-top:14px"></div>
    <p class="muted centro pequeno" style="margin-top:18px">${ui.fraseComparacao(CONFIG)}</p>
    <p class="centro" style="margin:8px 0 0"><button class="ligacao-btn" type="button" id="sair">Terminar sessão</button></p>`;
  document.getElementById('sair').addEventListener('click', () => {
    esquecerId(); userId = null; estadoAtual = null; mostrarConta(null, 'entrar');
  });
  desenharComum();
}

// ---------------------------------------------------------------------
// Rota pela Madeira (partilhada pelas duas versões; muda só QUEM sobe).
// ---------------------------------------------------------------------
function blocoRota(rota, total, estaSubidaM, { sujeito, chegou, extra = '' }) {
  const p = progressoRota(total, rota);
  const antes = progressoRota(Math.max(0, total - estaSubidaM), rota);
  const topo = p.topo;
  const chegouAoTopo = p.voltas > antes.voltas;
  const marcoNovo = !chegouAoTopo && p.marcos.find((m) => m.altitude > antes.atual && m.altitude <= p.atual);
  const pctInicial = antes.voltas === p.voltas ? antes.pct : 0;
  const ticks = p.marcos.filter((m) => m !== topo)
    .map((m) => `<i style="left:${(m.altitude / topo.altitude) * 100}%" title="${m.nome}"></i>`).join('');
  const lista = p.marcos.map((m) => {
    const cls = m.altitude <= p.atual ? 'feito' : (m === p.proximo ? 'proximo' : '');
    return `<li class="${cls}"><span>${m.nome}</span><span class="num" style="font-weight:700">${ui.fmt(m.altitude)} m</span></li>`;
  }).join('');
  const proximoTxt = p.proximo === topo
    ? `Próxima meta: <strong>${topo.nome}</strong>, o topo. Faltam <strong>${ui.fmt(p.falta, 1)} m</strong>.`
    : `Próxima meta: <strong>${p.proximo.nome}</strong> (${ui.fmt(p.proximo.altitude)} m). Faltam <strong>${ui.fmt(p.falta, 1)} m</strong>.`;
  const bandeira = ui.ICONES.bandeira.replace('<svg', '<svg width="18" height="18"');
  return `
    <span class="etiqueta">${rota.titulo}</span>
    ${chegouAoTopo ? `<p style="margin:10px 0 4px"><span class="selo">${bandeira} ${chegou(topo.nome)}</span></p>` : ''}
    ${marcoNovo ? `<p style="margin:10px 0 4px"><span class="selo">${bandeira} ${sujeito} ${marcoNovo.nome}!</span></p>` : ''}
    ${p.voltas >= 1 ? `<p style="margin:8px 0 0"><strong>${p.subidaN}.ª subida ao ${topo.nome}.</strong> A contagem recomeçou.</p>` : ''}
    <div style="margin:10px 0 12px"><span class="metros-grande num" data-contar="${p.atual}" data-casas="1">0</span>
      <span class="muted"> m de ${ui.fmt(topo.altitude)} m</span></div>
    <div class="barra" role="progressbar" aria-label="${rota.titulo}"
      aria-valuemin="0" aria-valuemax="${topo.altitude}" aria-valuenow="${Math.round(p.atual)}">
      <span data-de="${pctInicial * 100}" data-ate="${p.pct * 100}"></span></div>
    <div class="marcos" aria-hidden="true">${ticks}</div>
    <p style="margin:0 0 6px">${proximoTxt}</p>
    ${extra}
    <ul class="lista-marcos">${lista}</ul>`;
}

// Versão A — objetivo GLOBAL: os metros de toda a UMa.
function cartaoColetivo(c, estaSubidaM) {
  const total = metros(c.lancos);
  const extra = `<p class="muted pequeno" style="margin:0">A tua subida juntou-se a ${ui.fmt(c.subidas)} ${c.subidas === 1 ? 'subida' : 'subidas'} de ${ui.fmt(c.pessoas)} ${c.pessoas === 1 ? 'pessoa' : 'pessoas'} da UMa: ${ui.fmt(total, 1)} m no total.</p>`;
  return `<section class="cartao destaque" data-variante-ecra="A">
    ${blocoRota(CONFIG.rotaColetiva, total, estaSubidaM, {
      sujeito: 'A UMa chegou ao', chegou: (n) => `Chegámos ao ${n}!`, extra })}
  </section>`;
}

// Versão B — objetivo INDIVIDUAL: só os metros da própria pessoa.
function cartaoPessoal(pe, estaSubidaM) {
  const m = metros(pe.lancos);
  const extra = `<div class="numeros" style="margin:14px 0 4px">
      <div><div class="valor num" data-contar="${pe.subidas}">0</div><div class="rotulo">${pe.subidas === 1 ? 'subida' : 'subidas'}</div></div>
      <div><div class="valor num" data-contar="${pe.andares}">0</div><div class="rotulo">${pe.andares === 1 ? 'andar' : 'andares'}</div></div>
      <div><div class="valor num" data-contar="${m}" data-casas="1">0</div><div class="rotulo">${m === 1 ? 'metro' : 'metros'}</div></div>
    </div>`;
  return `<section class="cartao destaque" data-variante-ecra="B">
    ${blocoRota(CONFIG.rotaIndividual, m, estaSubidaM, {
      sujeito: 'Chegaste ao', chegou: (n) => `Chegaste ao ${n}!`, extra })}
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
  document.querySelectorAll('[data-contar]').forEach((el) =>
    ui.contar(el, Number(el.dataset.contar), Number(el.dataset.casas || 0)));
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
