import { CONFIG } from '../../config.js?v=202611241544';

// ---------- Metros (sempre recalculados com a altura atual de config.js) ----------
export function metros(lancos = {}) {
  let m = 0;
  for (const [l, n] of Object.entries(lancos)) m += (CONFIG.alturaLanco[l] ?? 3) * Number(n);
  return Math.round(m * 10) / 10;
}

export function metrosSubida(origem, destino) {
  let m = 0;
  for (let p = origem; p < destino; p++) m += CONFIG.alturaLanco[String(p)] ?? 3;
  return m;
}

/** Progresso numa rota (o último marco é o topo); ao chegar ao topo recomeça (2.ª subida, ...). */
export function progressoRota(total, rota) {
  const marcos = [...rota.marcos].sort((a, b) => a.altitude - b.altitude);
  const topo = marcos.at(-1);
  const voltas = Math.floor(total / topo.altitude);
  const atual = total - voltas * topo.altitude;
  const proximo = marcos.find((m) => m.altitude > atual) ?? topo;
  return {
    marcos, topo, voltas, subidaN: voltas + 1, atual,
    pct: atual / topo.altitude, proximo, falta: proximo.altitude - atual,
  };
}

// ---------- Datas (strings AAAA-MM-DD vindas do servidor, hora da Madeira) ----------
const d = (s) => new Date(`${s}T00:00:00Z`);
const iso = (x) => x.toISOString().slice(0, 10);
export function somarDias(s, n) { const x = d(s); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
export function segunda(s) { const x = d(s); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return iso(x); }

/**
 * Resumo comum às duas variantes: semana atual, meta, sequência e medalhas.
 * estado = resposta de estado_utilizador().
 */
export function resumo(estado) {
  const dias = estado?.dias ?? [];
  const hoje = estado?.hoje ?? iso(new Date());
  const meta = estado?.meta_semanal ?? null;
  const semanaAtual = segunda(hoje);

  const semanas = new Map(); // segunda -> { n, dias }
  let total = 0;
  for (const { d: dia, n } of dias) {
    const s = segunda(dia);
    const w = semanas.get(s) ?? { n: 0, dias: 0 };
    w.n += n; w.dias += 1; total += n;
    semanas.set(s, w);
  }
  const ordenadas = [...semanas.keys()].sort();
  const primeira = ordenadas[0];

  // Sequência de semanas: 1 semana de pausa é permitida; 2 seguidas sem subir quebram.
  // A semana atual ainda está a decorrer, por isso não conta como pausa.
  let sequencia = 0;
  if (primeira) {
    let s = semanas.has(semanaAtual) ? semanaAtual : somarDias(semanaAtual, -7);
    let vazias = 0;
    while (s >= primeira) {
      if (semanas.has(s)) { sequencia++; vazias = 0; } else if (++vazias >= 2) break;
      s = somarDias(s, -7);
    }
  }
  const emPausa = sequencia > 0 && !semanas.has(semanaAtual) && !semanas.has(somarDias(semanaAtual, -7));

  // Melhor sequência (com a mesma regra) e máximo de semanas estritamente seguidas.
  let melhor = 0, corrida = 0, vazias = 0, seguidas = 0, seguidasMax = 0;
  if (primeira) {
    for (let s = primeira; s <= semanaAtual; s = somarDias(s, 7)) {
      if (semanas.has(s)) { corrida++; vazias = 0; seguidas++; }
      else { seguidas = 0; if (++vazias >= 2) corrida = 0; }
      melhor = Math.max(melhor, corrida);
      seguidasMax = Math.max(seguidasMax, seguidas);
    }
  }

  const estaSemana = semanas.get(semanaAtual)?.n ?? 0;
  const maxDiasSemana = Math.max(0, ...[...semanas.values()].map((w) => w.dias));
  const metaCumprida = meta ? [...semanas.values()].some((w) => w.n >= meta) : false;

  const medalhas = [
    { id: 'primeiro', icone: 'pe', nome: 'Primeiro degrau', desc: 'A tua primeira subida', ganha: total >= 1 },
    { id: 'dois-dias', icone: 'calendario', nome: 'Voltei', desc: 'Subir em 2 dias diferentes', ganha: dias.length >= 2 },
    { id: 'semana-ativa', icone: 'raio', nome: 'Semana ativa', desc: 'Subir em 3 dias da mesma semana', ganha: maxDiasSemana >= 3 },
    { id: 'duas-semanas', icone: 'elo', nome: 'Duas seguidas', desc: 'Subir em 2 semanas seguidas', ganha: seguidasMax >= 2 },
    { id: 'habito', icone: 'chama', nome: 'Hábito', desc: 'Sequência de 3 semanas', ganha: melhor >= 3 },
    { id: 'palavra', icone: 'alvo', nome: 'Palavra dada', desc: 'Cumprir a meta que escolheste', ganha: metaCumprida },
  ];

  return { hoje, semanaAtual, estaSemana, meta, sequencia, emPausa, medalhas };
}
