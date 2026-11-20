// npm run backup — cópia de segurança local da base de dados (o plano Free do Supabase não faz backups).
// Guarda um JSON por tabela em backups/AAAA-MM-DD_HHMM/. A pasta backups/ não vai para o git.
// Palavras-passe e códigos de recuperação NÃO são copiados (só existem cifrados na BD).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, sql } from './lib.mjs';

const consultas = {
  config: `select chave, valor, descricao from public.config where chave <> 'painel_hash' order by chave`,
  pisos: `select piso, codigo, token from public.pisos order by piso`,
  contas: `select user_id, utilizador, ex_convidado, criado_em from public.contas order by criado_em`,
  participantes: `select user_id, variante, meta_semanal, criado_em from public.participantes order by criado_em`,
  scans: `select id, user_id, piso, variante, criado_em, resultado, piso_origem, andares, segundos, no_estudo
          from public.scans order by id`,
};

const agora = new Date();
const nome = `${agora.toISOString().slice(0, 10)}_${agora.toTimeString().slice(0, 5).replace(':', '')}`;
const pasta = join(RAIZ, 'backups', nome);
mkdirSync(pasta, { recursive: true });

for (const [tabela, q] of Object.entries(consultas)) {
  const linhas = JSON.parse(sql(`${q};`)).rows ?? [];
  writeFileSync(join(pasta, `${tabela}.json`), JSON.stringify(linhas, null, 2));
  console.log(`${tabela.padEnd(14)} ${String(linhas.length).padStart(6)} linhas`);
}
console.log(`\nBackup guardado em ${pasta}`);
console.log('Atenção: contém os tokens dos QR e os IDs. Guarda-o num local privado.');
