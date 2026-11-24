// Leitor de QR dentro da app (câmara do telemóvel).
// Usa o BarcodeDetector nativo quando existe (Android/Chrome) e o jsQR nos restantes (iPhone).
import { CONFIG } from '../../config.js?v=202611241645';

const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';

/** Extrai o token de um URL de QR do Sobe+ (ou null se não for do Sobe+). */
export function tokenDeTexto(texto) {
  try {
    const u = new URL(String(texto).trim());
    const site = new URL(`${CONFIG.siteUrl}/`);
    const origemOk = u.origin === site.origin || u.origin === location.origin;
    const caminhoOk = /\/s\/?$/.test(u.pathname);
    const p = u.searchParams.get('p');
    return origemOk && caminhoOk && p && p.length <= 64 ? p : null;
  } catch {
    return null;
  }
}

let jsqrPromessa = null;
function carregarJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrPromessa ??= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = JSQR; s.async = true;
    s.onload = () => (window.jsQR ? ok(window.jsQR) : falha(new Error('jsQR indisponível')));
    s.onerror = () => { jsqrPromessa = null; falha(new Error('Não foi possível carregar o leitor')); };
    document.head.appendChild(s);
  });
  return jsqrPromessa;
}

async function criarDetetor() {
  if ('BarcodeDetector' in window) {
    try {
      const formatos = await window.BarcodeDetector.getSupportedFormats?.();
      if (!formatos || formatos.includes('qr_code')) {
        const d = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => (await d.detect(video))[0]?.rawValue ?? null;
      }
    } catch { /* usa o jsQR */ }
  }
  const jsQR = await carregarJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const escala = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * escala); canvas.height = Math.round(h * escala);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * Abre a câmara num ecrã por cima da página e devolve o token lido,
 * ou null se a pessoa cancelar. Lança erro se a câmara não estiver disponível.
 */
export function lerQR() {
  return new Promise((resolver, rejeitar) => {
    const camada = document.createElement('div');
    camada.className = 'leitor';
    camada.setAttribute('role', 'dialog');
    camada.setAttribute('aria-modal', 'true');
    camada.setAttribute('aria-label', 'Ler QR code');
    camada.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="leitor-mira" aria-hidden="true"><span></span></div>
      <div class="leitor-topo"><strong>Aponta para o QR do piso</strong><p id="leitor-msg">A abrir a câmara…</p></div>
      <div class="leitor-baixo"><button class="btn secundario" type="button" id="leitor-cancelar">Cancelar</button></div>`;
    document.body.appendChild(camada);
    document.body.style.overflow = 'hidden';
    const video = camada.querySelector('video');
    const msg = camada.querySelector('#leitor-msg');
    let stream = null, ativo = true, ultimoAviso = 0;

    const fechar = (valor, erro) => {
      if (!ativo) return;
      ativo = false;
      stream?.getTracks().forEach((t) => t.stop());
      camada.remove();
      document.body.style.overflow = '';
      removeEventListener('keydown', tecla);
      if (erro) rejeitar(erro); else resolver(valor);
    };
    const tecla = (e) => { if (e.key === 'Escape') fechar(null); };
    addEventListener('keydown', tecla);
    camada.querySelector('#leitor-cancelar').addEventListener('click', () => fechar(null));

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem_camara');
        const [s, detetar] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
          criarDetetor(),
        ]);
        stream = s;
        if (!ativo) { s.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = s;
        await video.play().catch(() => {});
        msg.textContent = 'Mantém o QR dentro do quadrado.';

        const ciclo = async () => {
          if (!ativo) return;
          try {
            const texto = video.readyState >= 2 ? await detetar(video) : null;
            if (texto) {
              const token = tokenDeTexto(texto);
              if (token) { try { navigator.vibrate?.(40); } catch { /* */ } return fechar(token); }
              if (Date.now() - ultimoAviso > 2500) { msg.textContent = 'Este QR não é do Sobe+.'; ultimoAviso = Date.now(); }
            }
          } catch { /* frame ignorado */ }
          setTimeout(() => requestAnimationFrame(ciclo), 120);
        };
        ciclo();
      } catch (e) {
        const negado = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
        fechar(null, new Error(negado ? 'camara_negada' : 'sem_camara'));
      }
    })();
  });
}
