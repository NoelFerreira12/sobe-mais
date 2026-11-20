// Tarefas de administração (precisam de `supabase login` e `supabase link`).
//   node scripts/admin.mjs password [nova]   define a password do painel (gera uma se omitires)
//   node scripts/admin.mjs config:sync       envia min/max/cooldown/datas do config.js para a BD
//   node scripts/admin.mjs apagar <uuid...>  apaga IDs (ex.: IDs de teste)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, RAIZ, definirEnv, sql, lit } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);

function upsert(chave, valor) {
  return `insert into public.config (chave, valor) values (${lit(chave)}, ${lit(valor)})
          on conflict (chave) do update set valor = excluded.valor;`;
}

if (cmd === 'password') {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pw = args[0] || [...randomBytes(16)].map((b) => alfabeto[b % alfabeto.length]).join('');
  sql(`insert into public.config (chave, valor, descricao)
       values ('painel_hash', extensions.crypt(${lit(pw)}, extensions.gen_salt('bf', 10)), 'Hash bcrypt da password do painel')
       on conflict (chave) do update set valor = excluded.valor;
       delete from public.painel_tentativas;`);
  definirEnv('PAINEL_PASSWORD', pw);
  console.log(`Password do painel definida (guardada também em .env): ${pw}`);
} else if (cmd === 'config:sync') {
  sql([
    upsert('min_seg_por_andar', CONFIG.minSegPorAndar),
    upsert('max_seg_por_andar', CONFIG.maxSegPorAndar),
    upsert('cooldown_seg', CONFIG.cooldownSeg),
    upsert('estudo_inicio', CONFIG.estudo.inicio),
    upsert('estudo_fim', CONFIG.estudo.fim),
  ].join('\n'));
  console.log('Configuração enviada para a base de dados:');
  console.log(sql(`select chave, valor from public.config where chave <> 'painel_hash' order by chave;`));
} else if (cmd === 'limpar-testes') {
  // Apaga os IDs de um `npm run testar` interrompido e repõe a data de início do estudo.
  const f = join(RAIZ, 'testes.local.json');
  if (!existsSync(f)) { console.log('Nada para limpar (testes.local.json não existe).'); process.exit(0); }
  const { ids = [], convidados = [], inicio = CONFIG.estudo.inicio } = JSON.parse(readFileSync(f, 'utf8'));
  const todos = [...ids, ...convidados].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  sql(`update public.config set valor = ${lit(inicio)} where chave = 'estudo_inicio';
       ${todos.length ? `delete from public.participantes where user_id in (${todos.map(lit).join(',')});
       delete from public.contas where user_id in (${todos.map(lit).join(',')});` : ''}
       delete from public.login_tentativas where utilizador like 't\\_%';`);
  rmSync(f, { force: true });
  console.log(`Limpo: ${todos.length} IDs de teste apagados; estudo_inicio = ${inicio}.`);
} else if (cmd === 'apagar') {
  const ids = args.filter((a) => /^[0-9a-f-]{36}$/i.test(a));
  if (!ids.length) { console.error('Indica pelo menos um UUID.'); process.exit(1); }
  // Apagar a conta apaga também o participante e os scans (on delete cascade).
  console.log(sql(`delete from public.contas where user_id in (${ids.map(lit).join(',')}) returning user_id;`));
} else {
  console.log('Comandos: password [nova] | config:sync | limpar-testes | apagar <uuid...>');
  process.exit(1);
}
