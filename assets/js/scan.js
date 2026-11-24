import { CONFIG } from '../../config.js?v=202611241533';
import { rpc } from './api.js?v=202611241533';
import { lerId, definirId, esquecerId, criarId, lerTipo } from './id.js?v=202611241533';
import { resumo, metros, metrosSubida, progressoRota } from './calc.js?v=202611241533';
import * as ui from './ui.js?v=202611241533';
import { lerQR } from './leitor.js?v=202611241533';

const botaoLer = (txt = 'Ler QR do piso', cls = '') =>
  `<button class="btn ${cls}" type="button" data-ler>${ui.ICONES.qr}<span>${txt}</span></button>`;

const ecra = document.getElementById('ecra');
document.getElementById('topo').innerHTML = ui.cabecalho('../');
document.getElementById('rodape').innerHTML = ui.rodape('../');

const PEND = 'sobe_pendente';
let estadoAtual = null;
let userId = null;

// ---------------------------------------------------------------------
// Arranque: o token sai logo do URL (recarregar a página não conta como novo scan).
// ---------------------------------------------------------------------
let lidoEmPendente = Date.now();
function tokenDoPedido() {
  const p = new URLSearchParams(location.search).get('p');
  if (p) {
    lidoEmPendente = Date.now();
    try { sessionStorage.setItem(PEND, JSON.stringify({ token: p, t: lidoEmPendente })); } catch { /* */ }
    history.replaceState(null, '', location.pathname);
    return p;
  }
  try {
    const pend = JSON.parse(sessionStorage.getItem(PEND) || 'null');
    if (pend && Date.now() - pend.t < 120000) { lidoEmPendente = pend.t; return pend.token; }
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
  if (token) return registar(token, lidoEmPendente);
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
// Conta (opcional): alcunha + palavra-passe, sem email. Recuperação com código.
// Sem conta, a pessoa pode continuar: as subidas contam para o total da UMa.
// O token lido (se houver) fica à espera e é registado logo a seguir.
// ---------------------------------------------------------------------
const ERROS_CONTA = {
  utilizador_invalido: 'O nome tem de ter 3 a 24 caracteres: letras minúsculas, números, ponto, hífen ou _.',
  password_curta: 'A palavra-passe tem de ter pelo menos 6 caracteres.',
  utilizador_existe: 'Esse nome já está a ser usado. Escolhe outro ou entra na tua conta.',
  credenciais: 'Alcunha ou palavra-passe incorretas. Não tens a certeza da tua alcunha? Toca em «Esqueci-me» e usa só o teu código de recuperação.',
  codigo_errado: 'Código de recuperação incorreto. Confirma o código (ou deixa a alcunha em branco e usa só o código).',
  bloqueado: 'Demasiadas tentativas falhadas. Espera 15 minutos.',
  muitas_contas: 'Muitas contas criadas agora mesmo. Tenta daqui a pouco.',
};

const limpaNome = (s) => String(s || '').replace(/[^a-z0-9._-]/gi, '');

function mostrarConta(token, modo = 'criar', erro = '', nome = '', sugestoes = []) {
  const criar = modo === 'criar', recuperar = modo === 'recuperar';
  const titulo = recuperar ? 'Recuperar conta' : (token ? 'Quase lá!' : `Sobe<span style="color:var(--laranja)">+</span>`);
  const sub = recuperar
    ? 'Basta o código de recuperação que guardaste. Se não te lembras da alcunha, deixa-a em branco: dizemos-ta a seguir.'
    : (token ? 'Entra ou cria uma conta. Também podes continuar sem conta.' : 'Entra ou cria uma conta para guardares o teu progresso.');
  ecra.innerHTML = `
    <div class="hero aparecer" style="padding-bottom:0"><div class="ilustracao" style="width:min(170px,50%)">${ui.MONTANHA}</div>
      <h1>${titulo}</h1><p>${sub}</p></div>
    <section class="cartao aparecer aparecer-2">
      ${recuperar ? '' : `<div class="separadores" role="tablist" aria-label="Conta">
        <button type="button" role="tab" data-modo="criar" aria-selected="${criar}">Criar conta</button>
        <button type="button" role="tab" data-modo="entrar" aria-selected="${!criar}">Já tenho conta</button>
      </div>`}
      <form id="form-conta" class="pilha" novalidate>
        <div>
          <label for="u"><strong>${recuperar ? 'Alcunha <span class="muted" style="font-weight:600">(opcional)</span>' : 'Nome de utilizador (alcunha)'}</strong></label>
          <input type="text" id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off"
            spellcheck="false" minlength="3" maxlength="24" ${recuperar ? '' : 'required'} value="${limpaNome(nome)}">
          ${criar ? '<p class="muted pequeno" style="margin:6px 0 0">Usa uma alcunha. Não uses o teu nome verdadeiro nem o número de aluno.</p>' : ''}
        </div>
        ${recuperar ? `<div>
          <label for="cod"><strong>Código de recuperação</strong></label>
          <input type="text" id="cod" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false"
            placeholder="XXXX-XXXX-XXXX" maxlength="20" required>
        </div>` : ''}
        <div>
          <label for="pw"><strong>${recuperar ? 'Nova palavra-passe' : 'Palavra-passe'}</strong></label>
          <input type="password" id="pw" name="password" autocomplete="${criar || recuperar ? 'new-password' : 'current-password'}" minlength="6" maxlength="72" required>
          ${criar ? '<p class="muted pequeno" style="margin:6px 0 0">Mínimo 6 caracteres. A seguir damos-te um código para recuperares a conta se a esqueceres.</p>' : ''}
        </div>
        ${criar ? `<div class="aviso-caixa">
          <p style="margin:0"><strong>Registamos um ID anónimo e a hora a que lês os QR, só para contar subidas.</strong></p>
          <p class="pequeno" style="margin:6px 0 0">Sem email nem dados pessoais. Participar é voluntário e podes apagar tudo quando quiseres.
            Ao continuar aceitas os <a href="../termos/">Termos</a> e a <a href="../privacidade/">Privacidade</a>.</p>
        </div>` : ''}
        ${erro ? `<div class="aviso-caixa" role="alert"><p style="margin:0">${erro}</p>
          ${sugestoes.length ? `<p class="pequeno" style="margin:8px 0 6px">Nomes livres (toca para usar):</p>
          <div class="chips">${sugestoes.map((s) => limpaNome(s)).map((s) => `<button type="button" class="chip" data-sugestao="${s}">${s}</button>`).join('')}</div>` : ''}
        </div>` : ''}
        <button class="btn" type="submit">${criar ? 'Aceitar e criar conta' : recuperar ? 'Mudar palavra-passe e entrar' : 'Entrar'}</button>
        ${modo === 'entrar' ? '<p class="centro" style="margin:0"><button type="button" class="ligacao-btn" data-modo="recuperar">Esqueci-me da palavra-passe</button></p>' : ''}
        ${recuperar ? '<p class="centro" style="margin:0"><button type="button" class="ligacao-btn" data-modo="entrar">Voltar a entrar</button></p>' : ''}
      </form>
    </section>
    ${recuperar ? '' : `<section class="cartao aparecer aparecer-3" style="margin-top:14px">
      <h2>Sem conta?</h2>
      <p class="muted" style="margin:0 0 8px">Sobe na mesma, sem conta. Só não dá para usar o teu progresso noutro telemóvel
        nem recuperá-lo se mudares de telemóvel. Podes criar conta mais tarde e não perdes nada.</p>
      <p class="pequeno" style="margin:0 0 12px"><strong>Registamos um ID anónimo e a hora a que lês os QR, só para contar subidas.</strong>
        <a href="../privacidade/">Privacidade</a></p>
      <button class="btn secundario" type="button" id="sem-conta">Continuar sem conta</button>
    </section>`}`;

  ecra.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    mostrarConta(token, b.dataset.modo, '', document.getElementById('u').value);
  }));
  ecra.querySelectorAll('[data-sugestao]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById('u').value = b.dataset.sugestao;
    ecra.querySelectorAll('[data-sugestao]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.getElementById('pw').focus();
  }));
  document.getElementById('sem-conta')?.addEventListener('click', () => {
    userId = lerTipo() === 'convidado' && lerId() ? lerId() : criarId();
    if (token) registar(token); else mostrarEstado();
  });
  document.getElementById('form-conta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const u = document.getElementById('u').value.trim().toLowerCase();
    const pw = document.getElementById('pw').value;
    const btn = ev.submitter || ev.target.querySelector('button[type=submit]');
    btn.disabled = true;
    let r;
    try {
      if (recuperar) {
        r = await rpc('recuperar_conta', { p_utilizador: u, p_codigo: document.getElementById('cod').value, p_nova_password: pw });
      } else {
        r = criar
          // Se este telemóvel já usou o Sobe+ sem conta, o servidor fica a saber (para a análise).
          ? await rpc('criar_conta', { p_utilizador: u, p_password: pw, p_convidado: lerTipo() === 'convidado' ? lerId() : null })
          : await rpc('entrar', { p_utilizador: u, p_password: pw });
      }
    } catch (e) {
      console.error(e);
      return mostrarConta(token, modo, 'Sem ligação ao servidor. Tenta outra vez.', u);
    }
    if (!r.ok) {
      const msg = r.erro === 'utilizador_existe' && criar
        ? `A alcunha «${limpaNome(u)}» já é de outra pessoa. Cada alcunha é única: escolhe outra.`
        : (ERROS_CONTA[r.erro] ?? 'Algo correu mal. Tenta outra vez.');
      return mostrarConta(token, modo, msg, u, r.sugestoes || []);
    }
    definirId(r.user_id, r.utilizador);
    userId = r.user_id;
    const seguir = () => (token ? registar(token) : mostrarEstado());
    if (r.codigo_recuperacao) mostrarCodigo(r.codigo_recuperacao, seguir, recuperar, r.utilizador);
    else seguir();
  });
}

/** Mostra o código de recuperação (só aparece uma vez). */
function mostrarCodigo(codigo, seguir, novo = false, alcunha = '') {
  const cod = String(codigo).replace(/[^A-Z0-9-]/g, '');
  const nome = limpaNome(alcunha);
  ecra.innerHTML = `
    <section class="cartao aparecer">
      <h1>${novo ? 'Palavra-passe mudada' : 'Conta criada!'}</h1>
      <p>Guarda estes dois dados: tira um print ou copia-os para as tuas notas.
        Se te esqueceres da palavra-passe (ou da alcunha), é com o código que voltas a entrar.</p>
      <p class="etiqueta" style="margin:14px 0 4px">A tua alcunha</p>
      <div class="codigo-rec" style="margin-top:0;border-style:solid;font-size:1.4rem" id="alcunha">${nome}</div>
      <p class="etiqueta" style="margin:14px 0 4px">${novo ? 'Novo código' : 'Código'} de recuperação</p>
      <div class="codigo-rec num" style="margin-top:0" id="codigo" aria-label="Código de recuperação">${cod}</div>
      <div class="pilha" style="margin-top:14px">
        <button class="btn secundario" type="button" id="copiar">Copiar alcunha e código</button>
        <button class="btn" type="button" id="guardei">Já guardei, continuar</button>
      </div>
      <p class="muted pequeno" style="margin:12px 0 0">Não o mostramos outra vez. Com a sessão iniciada podes gerar um novo no ecrã do teu progresso.</p>
    </section>`;
  document.getElementById('copiar').addEventListener('click', async (ev) => {
    try {
      await navigator.clipboard.writeText(`Sobe+ · alcunha: ${nome} · código de recuperação: ${cod}`);
      ev.target.textContent = 'Copiado ✓';
    } catch { ev.target.textContent = 'Seleciona e copia o texto acima'; }
  });
  document.getElementById('guardei').addEventListener('click', seguir);
}

function carregar(txt = 'A registar…') {
  ecra.innerHTML = `<div class="carregar"><div class="roda"></div><span>${txt}</span></div>`;
}

// Nas escadas a rede costuma falhar: a leitura fica guardada e é reenviada sozinha
// quando a ligação voltar, durante no máximo 2 minutos (a hora conta no servidor).
const VALIDADE_LEITURA_MS = 120000;
let pararReenvio = () => {};

async function registar(token, lidoEm = Date.now()) {
  pararReenvio();
  carregar();
  let r;
  try {
    r = await rpc('registar_scan', { p_user_id: userId, p_token: token });
  } catch (e) {
    console.error(e);
    return mostrarErroRede(token, lidoEm);
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

function mostrarErroRede(token, lidoEm) {
  const resta = lidoEm + VALIDADE_LEITURA_MS - Date.now();
  if (resta <= 0) {
    limparPendente();
    ecra.innerHTML = `
      <section class="cartao resultado aviso aparecer">
        <div class="icone">${ui.ICONES.info}</div>
        <h1>Sem ligação</h1>
        <p>Passou demasiado tempo sem internet e esta leitura já não conta. Quando tiveres rede, lê o QR outra vez.</p>
        ${botaoLer('Ler QR outra vez')}
      </section>`;
    return;
  }
  ecra.innerHTML = `
    <section class="cartao resultado aviso aparecer">
      <div class="icone">${ui.ICONES.info}</div>
      <h1>Sem ligação</h1>
      <p>A leitura está guardada. Enviamo-la sozinhos assim que a internet voltar, não precisas de fazer nada.</p>
      <p class="muted pequeno" style="margin:0 0 12px">A tentar de novo durante mais ${Math.ceil(resta / 1000)} s.</p>
      <button class="btn" id="repetir">Tentar agora</button>
    </section>`;
  const tentar = () => registar(token, lidoEm);
  document.getElementById('repetir').addEventListener('click', tentar);
  const aoVoltar = () => tentar();
  addEventListener('online', aoVoltar, { once: true });
  const temporizador = setTimeout(tentar, Math.min(6000, resta));
  pararReenvio = () => { removeEventListener('online', aoVoltar); clearTimeout(temporizador); pararReenvio = () => {}; };
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

const TOPO = Math.max(...CONFIG.pisos);

/**
 * Texto de cada resultado. Todas as leituras que não são uma subida válida
 * deixam esse piso como novo ponto de partida, e o ecrã di-lo claramente.
 */
function textoResultado(r) {
  const P = ui.nomePiso;
  const noTopo = r.piso === TOPO;
  const topo = (extra) => ({ cls: '', icone: 'bandeira', titulo: `Estás no topo, ${P(r.piso)}!`,
    texto: 'Para a próxima subida, lê o QR do piso onde começares.', extra });
  const comeco = (extra) => (noTopo ? topo(extra) : { cls: '', icone: 'subir', partida: true,
    titulo: `Começaste no ${P(r.piso)}!`, texto: 'Sobe e lê o QR quando chegares.', extra });
  switch (r.resultado) {
    case 'inicio':
      return comeco('Ao teu ritmo: não há pressa nenhuma.');
    case 'descer':
      return comeco(`Descer não conta, mas boa caminhada! A leitura anterior (${P(r.piso_origem)}) ficou sem subida.`);
    case 'lento':
      return comeco(`Passou muito tempo desde a leitura no ${P(r.piso_origem)}, por isso começas outra vez a partir deste piso.`);
    case 'valida':
      return { cls: 'ok', icone: 'check', titulo: 'Subida registada!',
        grande: `+${r.andares} ${r.andares === 1 ? 'andar' : 'andares'}`,
        texto: `Do ${P(r.piso_origem)} ao ${P(r.piso)}.` };
    case 'continua': {
      const total = r.andares_subida || r.andares;
      return { cls: 'ok', icone: 'subir', titulo: noTopo ? 'Chegaste ao topo!' : 'Continuas a subir!', partida: !noTopo,
        grande: `+${r.andares} ${r.andares === 1 ? 'andar' : 'andares'}`,
        texto: `Do ${P(r.piso_origem)} ao ${P(r.piso)}. Esta subida já vai em ${total} ${total === 1 ? 'andar' : 'andares'}.`,
        extra: noTopo ? '' : 'Se continuares, lê o QR do próximo piso.' };
    }
    case 'rapido':
      return { cls: 'aviso', icone: 'relogio', titulo: 'Foste rápido demais', partida: !noTopo,
        texto: `Para contar, ${r.andares} ${r.andares === 1 ? 'andar tem' : 'andares têm'} de demorar pelo menos ${ui.duracao(r.min_seg)}. Sobe com calma, ao teu ritmo.`,
        extra: noTopo ? 'Para a próxima subida, lê o QR do piso onde começares.'
          : `Começas outra vez a partir do ${P(r.piso)}: sobe e lê o QR quando chegares.` };
    case 'cooldown': {
      const min = Math.max(1, Math.ceil((r.cooldown_restante_seg ?? 60) / 60));
      return { cls: 'aviso', icone: 'pausa', titulo: 'Já contámos uma subida há pouco', partida: !noTopo,
        texto: `As subidas voltam a contar daqui a cerca de ${min} min.`,
        extra: noTopo ? '' : `O ${P(r.piso)} fica como ponto de partida.` };
    }
    case 'repetido': {
      const u = r.estado?.ultimo_scan;
      if (u && (u.resultado === 'valida' || u.resultado === 'continua') && u.piso === r.piso) {
        return { cls: 'ok', icone: 'check', titulo: 'Esta subida já está registada', partida: !noTopo,
          texto: noTopo ? 'Chegaste ao topo. Para a próxima subida, lê o QR do piso onde começares.'
            : `Chegaste ao ${P(r.piso)}. Se continuares a subir, este piso é o ponto de partida.` };
      }
      if (noTopo) return topo('Este QR já tinha sido lido agora mesmo.');
      return { cls: '', icone: 'subir', partida: true, titulo: `Já estás a começar no ${P(r.piso)}`,
        texto: 'Este QR já tinha sido lido agora mesmo. Sobe e lê o QR quando chegares.' };
    }
    default:
      return { cls: 'aviso', icone: 'info', titulo: 'Leitura registada', texto: '' };
  }
}

function mostrarResultado(r) {
  const t = textoResultado(r);
  // 'continua' soma andares à mesma subida: conta para a rota como uma subida válida.
  const valida = r.resultado === 'valida' || r.resultado === 'continua';
  ecra.innerHTML = `
    <section class="cartao resultado ${t.cls} aparecer">
      <div class="icone">${ui.ICONES[t.icone]}</div>
      <h1>${t.titulo}</h1>
      ${t.grande ? `<div class="grande num">${t.grande}</div>` : ''}
      ${t.texto ? `<p>${t.texto}</p>` : ''}
      ${t.extra ? `<p class="pequeno" style="margin:0">${t.extra}</p>` : ''}
    </section>
    <div class="aparecer" style="margin-top:14px">${t.partida
      ? botaoLer('Ler o QR quando chegares')
      : botaoLer('Ler o próximo QR', 'secundario')}</div>
    ${valida && r.conta === false ? cartaoSemConta('A tua subida já conta.') : ''}
    <div id="perfil" class="pilha aparecer aparecer-2" style="margin-top:14px"></div>`;
  // Depois de uma subida válida, a rota anima desde o valor anterior.
  desenharPerfil(valida ? metrosSubida(r.piso_origem, r.piso) : 0, valida);
  if (r.resultado === 'valida') {
    ui.vibrar();
    setTimeout(ui.confettis, 250);
  } else if (r.resultado === 'continua') {
    ui.vibrar([30, 40, 30]);
  } else if (t.partida) {
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
  const convidado = !estadoAtual.conta;
  if (convidado && lerTipo() !== 'convidado') {
    esquecerId(); userId = null;
    return mostrarConta(null, 'entrar', 'A tua sessão terminou. Entra outra vez.');
  }
  const u = estadoAtual.ultimo_scan;
  const janela = estadoAtual.janela_seg ?? CONFIG.maxSegPorAndar * (TOPO - Math.min(...CONFIG.pisos));
  const emCurso = u && u.piso < TOPO && u.segundos_desde <= janela;
  const aviso = emCurso
    ? `<span class="etiqueta">Ponto de partida</span>
       <h2 style="margin:6px 0">${ui.nomePiso(u.piso)}</h2>
       <p style="margin:0">Leste este QR há ${ui.duracao(u.segundos_desde)}. Sobe e lê o QR quando chegares.</p>
       <p class="muted pequeno" style="margin:6px 0 0">Mudaste de ideias? Não faz mal: lê o QR do piso onde estiveres e começas uma subida nova.</p>`
    : `<h2>Pronto para subir?</h2><p style="margin:0">Lê o QR do piso onde estás para começar uma subida.</p>`;
  const nome = limpaNome(estadoAtual.utilizador);
  ecra.innerHTML = `
    ${convidado ? '' : `<p class="ola aparecer">Olá, <strong>${nome}</strong></p>`}
    ${cartaoQuestionario(estadoAtual)}
    <section class="cartao destaque aparecer">${aviso}</section>
    <div class="aparecer" style="margin-top:14px">${botaoLer()}</div>
    ${convidado ? cartaoSemConta('As tuas subidas contam na mesma.') : ''}
    <div id="perfil" class="pilha aparecer aparecer-2" style="margin-top:14px"></div>
    <p class="muted centro pequeno" style="margin-top:18px">${ui.fraseComparacao(CONFIG)}</p>
    <details class="cartao mais-metas" style="margin-top:14px;padding:14px 20px">
      <summary><span>${convidado ? 'Os meus dados' : 'A minha conta'}</span></summary>
      <div class="pilha" style="margin-top:12px">
        ${convidado ? '' : `<button class="btn secundario pequeno" type="button" id="novo-codigo">Novo código de recuperação</button>
        <button class="btn secundario pequeno" type="button" id="sair">Terminar sessão</button>`}
        ${pedidoInstalar ? '<button class="btn secundario pequeno" type="button" id="instalar">Instalar a app no telemóvel</button>' : ''}
        <button class="btn secundario pequeno" type="button" id="descarregar">Descarregar os meus dados</button>
        <button class="btn secundario pequeno" type="button" id="apagar" style="color:#B3261E">${convidado ? 'Apagar os meus dados' : 'Apagar a minha conta e dados'}</button>
        <p class="muted pequeno" style="margin:0"><a href="../privacidade/">Privacidade</a> · <a href="../termos/">Termos</a></p>
      </div>
    </details>`;
  document.getElementById('apagar').addEventListener('click', () => mostrarApagar(convidado));
  document.getElementById('descarregar').addEventListener('click', descarregarDados);
  document.getElementById('instalar')?.addEventListener('click', async (ev) => {
    const pedido = pedidoInstalar; pedidoInstalar = null;
    ev.currentTarget.remove();
    try { await pedido?.prompt(); } catch { /* o utilizador fechou */ }
  });
  document.getElementById('sair')?.addEventListener('click', () => {
    esquecerId(); userId = null; estadoAtual = null; mostrarConta(null, 'entrar');
  });
  document.getElementById('novo-codigo')?.addEventListener('click', async () => {
    if (!confirm('Gerar um código de recuperação novo? O antigo deixa de funcionar.')) return;
    try {
      const r = await rpc('novo_codigo_recuperacao', { p_user_id: userId });
      if (r.ok) mostrarCodigo(r.codigo_recuperacao, () => mostrarEstado(), true, r.utilizador);
    } catch (e) { console.error(e); alert('Sem ligação ao servidor. Tenta outra vez.'); }
  });
  desenharPerfil();
}

/** Direito de acesso/portabilidade (RGPD): ficheiro JSON com os dados desta pessoa. */
async function descarregarDados(ev) {
  const b = ev.currentTarget;
  b.disabled = true;
  try {
    const r = await rpc('meus_dados', { p_user_id: userId });
    if (!r.ok) throw new Error(r.erro);
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'sobe-os-meus-dados.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e); alert('Não foi possível descarregar os dados. Tenta outra vez.');
  } finally { b.disabled = false; }
}

// Android/Chrome: guarda o pedido de instalação para mostrar o botão "Instalar a app".
let pedidoInstalar = null;
addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); pedidoInstalar = ev; });

/** Direito ao apagamento: apaga conta, participante e todas as leituras. */
function mostrarApagar(convidado, erro = '') {
  ecra.innerHTML = `
    <section class="cartao aparecer">
      <h1>${convidado ? 'Apagar os meus dados' : 'Apagar a conta e os dados'}</h1>
      <p>Vamos apagar ${convidado ? 'o teu ID anónimo' : 'a tua conta'} e <strong>todas as tuas leituras</strong>.
        As tuas subidas deixam também de contar para o total da UMa. <strong>Não dá para desfazer.</strong></p>
      <form id="form-apagar" class="pilha" novalidate>
        ${convidado ? '' : `<div><label for="pw-apagar"><strong>Confirma com a tua palavra-passe</strong></label>
          <input type="password" id="pw-apagar" autocomplete="current-password" required></div>`}
        ${erro ? `<p class="aviso-caixa" role="alert" style="margin:0">${erro}</p>` : ''}
        <button class="btn" type="submit" style="background:#B3261E">Apagar definitivamente</button>
        <button class="btn secundario" type="button" id="cancelar">Cancelar</button>
      </form>
    </section>`;
  document.getElementById('cancelar').addEventListener('click', () => mostrarEstado());
  document.getElementById('form-apagar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = convidado ? null : document.getElementById('pw-apagar').value;
    let r;
    try { r = await rpc('apagar_dados', { p_user_id: userId, p_password: pw }); } catch (e) {
      console.error(e); return mostrarApagar(convidado, 'Sem ligação ao servidor. Tenta outra vez.');
    }
    if (!r.ok) {
      return mostrarApagar(convidado, r.erro === 'credenciais' ? 'Palavra-passe incorreta.'
        : (ERROS_CONTA[r.erro] ?? 'Não foi possível apagar. Tenta outra vez.'));
    }
    esquecerId(); userId = null; estadoAtual = null;
    ecra.innerHTML = `<section class="cartao resultado ok aparecer"><div class="icone">${ui.ICONES.check}</div>
      <h1>Dados apagados</h1><p>Apagámos tudo o que estava associado a ${convidado ? 'este telemóvel' : 'esta conta'}. Obrigado por teres participado.</p>
      <a class="btn secundario" href="../">Voltar ao início</a></section>`;
  });
}

/** Questionário final: só com link em config.js e a partir do último dia do estudo. */
function cartaoQuestionario(e) {
  if (!CONFIG.questionario || !e?.hoje || e.hoje < CONFIG.estudo.fim) return '';
  const grupo = e.coletivo ? 'coletivo' : e.pessoal ? 'pessoal' : 'sem-grupo';
  const url = CONFIG.questionario.replaceAll('{grupo}', encodeURIComponent(grupo));
  return `<section class="cartao aparecer" style="margin-bottom:14px">
    <h2>O estudo terminou. Obrigado!</h2>
    <p class="muted" style="margin:0 0 12px">Ajuda-nos a perceber como correu: são poucas perguntas e demora 1 minuto.</p>
    <a class="btn" href="${url}" target="_blank" rel="noopener">Responder ao questionário</a>
  </section>`;
}

/** Convite para criar conta (só para quem está sem conta). */
function cartaoSemConta(frase) {
  return `<section class="cartao aparecer aparecer-2" style="margin-top:14px">
    <h2>Estás sem conta</h2>
    <p class="muted" style="margin:0 0 12px">${frase} Com uma conta (só alcunha e palavra-passe) guardas o teu progresso
      e podes usá-lo noutro telemóvel. Se a criares neste telemóvel, não perdes nada do que já fizeste.</p>
    <button class="btn secundario" type="button" data-conta>Criar conta ou entrar</button>
  </section>`;
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
    <details class="mais-metas" style="margin-top:8px">
      <summary><span>Ver todas as metas</span> <span class="muted" style="text-decoration:none;font-weight:600">
        (${p.marcos.filter((m) => m.altitude <= p.atual).length} de ${p.marcos.length})</span></summary>
      <ul class="lista-marcos">${lista}</ul>
    </details>`;
}

// Versão A (e sem conta) — objetivo GLOBAL: os metros de toda a UMa.
function cartaoColetivo(c, estaSubidaM, aposSubida) {
  const total = metros(c.lancos);
  const quem = `${ui.fmt(c.subidas)} ${c.subidas === 1 ? 'subida' : 'subidas'} de ${ui.fmt(c.pessoas)} ${c.pessoas === 1 ? 'pessoa' : 'pessoas'} da UMa`;
  const extra = `<p class="muted pequeno" style="margin:0">${aposSubida ? `A tua subida juntou-se a ${quem}` : `Até agora: ${quem}`}: ${ui.fmt(total, 1)} m no total.</p>`;
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
// Perfil: sempre visível (no ecrã de progresso e depois de cada leitura).
// Rota e histórico seguem o grupo: A -> UMa; B -> pessoal (com ou sem conta).
// Sem grupo ainda (sem conta, antes da 1.ª leitura): nada do grupo, para não influenciar.
// ---------------------------------------------------------------------
function desenharPerfil(estaSubidaM = 0, aposSubida = false, { animado = true } = {}) {
  const alvo = document.getElementById('perfil');
  if (!alvo || !estadoAtual) return;
  const e = estadoAtual;
  let html = '';
  if (!e.coletivo && !e.pessoal) {
    html += `<section class="cartao destaque"><span class="etiqueta">A tua rota pela Madeira</span>
      <p style="margin:8px 0 0">Aparece depois da tua primeira leitura, com metas como a Fortaleza do Pico e o Cabo Girão.</p></section>`;
  } else if (e.coletivo) {
    html += cartaoColetivo(e.coletivo, estaSubidaM, aposSubida);
    html += ui.cartaoHistorico(e.coletivo.dias, e.coletivo.hoje || e.hoje, {
      titulo: 'Subidas da UMa', vazio: 'Ainda ninguém subiu nestes dias. Sê o primeiro!' });
  } else if (e.pessoal) {
    html += cartaoPessoal(e.pessoal, estaSubidaM);
    html += ui.cartaoHistorico(e.dias, e.hoje, {
      titulo: 'As tuas subidas', vazio: 'Ainda sem subidas nestes dias. A primeira está à distância de um QR.' });
  }
  const r = resumo(e);
  html += ui.cartaoSemana(r) + ui.cartaoMedalhas(r, ui.medalhasNovas(r));
  alvo.innerHTML = html;
  animar(alvo, animado);
}

function animar(raiz = document, animado = true) {
  raiz.querySelectorAll('[data-contar]').forEach((el) => {
    const v = Number(el.dataset.contar), casas = Number(el.dataset.casas || 0);
    if (animado) ui.contar(el, v, casas); else el.textContent = ui.fmt(v, casas);
  });
  raiz.querySelectorAll('.barra > span[data-ate]').forEach((el) => {
    if (!animado) { el.style.width = `${el.dataset.ate}%`; return; }
    el.style.width = `${el.dataset.de}%`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = `${el.dataset.ate}%`; }));
  });
}

ecra.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-ler]')) abrirLeitor();
  if (ev.target.closest('[data-conta]')) mostrarConta(null, 'criar');
});

ecra.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-meta]');
  if (!b || !userId) return;
  const meta = Number(b.dataset.meta) || null;
  b.disabled = true;
  try {
    const r = await rpc('definir_meta', { p_user_id: userId, p_meta: meta });
    if (r.ok) { estadoAtual.meta_semanal = r.meta_semanal; desenharPerfil(0, false, { animado: false }); }
  } catch (e) {
    console.error(e);
    b.disabled = false;
  }
});

arrancar();
