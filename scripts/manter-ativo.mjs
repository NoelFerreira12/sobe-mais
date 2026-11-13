// Chamado 1×/dia pelo GitHub Actions para o projeto Supabase (plano Free) não ser pausado.
import { rpc } from './lib.mjs';

const r = await rpc('progresso_coletivo');
if (typeof r?.subidas !== 'number') {
  console.error('Resposta inesperada', r);
  process.exit(1);
}
console.log(`OK — Supabase ativo (${new Date().toISOString()})`);
