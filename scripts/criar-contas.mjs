// npm run criar-contas -- <contas.csv> [--simular]
// Cria contas a partir de um CSV com as colunas utilizador e password (separador , ; ou tab).
//  * Mesmas regras e mesmo hash do registo da app (criar_conta): alcunha em minúsculas,
//    3–24 caracteres [a-z0-9._-], password 6–72, bcrypt custo 8, código de recuperação.
//  * user_id e criado_em são gerados pela base de dados.
//  * NÃO cria participante nem leituras: o grupo A/B é sorteado no 1.º login ou na 1.ª
//    leitura (contas que nunca chegam a ser usadas não pesam no equilíbrio A/B).
//  * Alcunhas que já existem não são alteradas: avisa e passa à seguinte.
//  * No fim testa o login de cada conta nova com a função real `entrar`, dentro de uma
//    subtransação desfeita (não fica tentativa de login nem participante registado).
// O CSV não deve ir para o git (o .gitignore apanha contas*.csv). As passwords nunca são
// escritas em disco por este script; os códigos de recuperação ficam em backups/ (fora do git).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { RAIZ, sql, lit } from './lib.mjs';

const args = process.argv.slice(2);
const simular = args.includes('--simular');
const ficheiro = args.find((a) => !a.startsWith('--'));
if (!ficheiro || !existsSync(ficheiro)) {
  console.error('Uso: npm run criar-contas -- <contas.csv> [--simular]');
  process.exit(1);
}

// ---- ler o CSV ----------------------------------------------------------------
const linhas = readFileSync(ficheiro, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
const sep = ['\t', ';', ','].find((s) => linhas[0]?.includes(s));
if (!sep) { console.error('Não encontrei o separador na 1.ª linha (usa , ; ou tab).'); process.exit(1); }
const limpar = (c) => c.trim().replace(/^"(.*)"$/, '$1');
const cab = linhas[0].split(sep).map((c) => limpar(c).toLowerCase());
const iU = cab.indexOf('utilizador');
const iP = cab.indexOf('password');
if (iU < 0 || iP < 0) { console.error('O CSV tem de ter as colunas "utilizador" e "password".'); process.exit(1); }

const CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // o mesmo alfabeto de privado.novo_codigo()
const novoCodigo = () => {
  const s = Array.from({ length: 12 }, () => CODIGO[randomInt(CODIGO.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
};

const contas = [];
const vistos = new Set();
for (const [n, linha] of linhas.slice(1).entries()) {
  const campos = linha.split(sep);
  // a password é a última coluna? então pode conter o separador
  const pw = iP === cab.length - 1 ? campos.slice(iP).join(sep).trim() : limpar(campos[iP] ?? '');
  const original = limpar(campos[iU] ?? '');
  const u = original.toLowerCase();
  const onde = `linha ${n + 2} (${original || '?'})`;
  if (!/^[a-z0-9._-]{3,24}$/.test(u)) { console.warn(`⚠ ${onde}: alcunha inválida (3–24 de a-z 0-9 . _ -) — ignorada`); continue; }
  if (pw.length < 6 || pw.length > 72) { console.warn(`⚠ ${onde}: password tem de ter 6–72 caracteres — ignorada`); continue; }
  if (vistos.has(u)) { console.warn(`⚠ ${onde}: repetida no CSV — ignorada`); continue; }
  if (u !== original) console.warn(`ℹ ${onde}: fica "${u}" (a app guarda as alcunhas em minúsculas; o login aceita das duas formas)`);
  vistos.add(u);
  contas.push({ u, pw, codigo: novoCodigo() });
}
if (!contas.length) { console.error('Nenhuma conta válida no CSV.'); process.exit(1); }

const rows = (txt) => JSON.parse(txt).rows ?? [];
const listaU = contas.map((c) => lit(c.u)).join(',');

// ---- quem já existe -------------------------------------------------------------
const existentes = new Set(rows(sql(`select utilizador from public.contas where utilizador in (${listaU});`)).map((r) => r.utilizador));
for (const u of existentes) console.warn(`⚠ "${u}" já existe — não foi alterada`);
const aCriar = contas.filter((c) => !existentes.has(c.u));
console.log(`\n${aCriar.length} conta(s) a criar, ${existentes.size} já existente(s).`);
if (simular) { console.log('(--simular: nada foi escrito)'); process.exit(0); }
if (!aCriar.length) process.exit(0);

// ---- criar --------------------------------------------------------------------
// "on conflict do nothing": se alguém registar a mesma alcunha entretanto, não é sobrescrita.
sql(`with novos (utilizador, pw, codigo) as (values
       ${aCriar.map((c) => `(${lit(c.u)}, ${lit(c.pw)}, ${lit(c.codigo)})`).join(',\n       ')})
     insert into public.contas (utilizador, password_hash, recuperacao_sha, ex_convidado)
     select utilizador, extensions.crypt(pw, extensions.gen_salt('bf', 8)), privado.sha_codigo(codigo), false
     from novos
     on conflict (utilizador) do nothing;`);

// Relê da BD (robusto se a chamada acima tiver sido repetida por falha de rede).
const naBd = new Map(rows(sql(`select user_id, utilizador, criado_em from public.contas
                                where utilizador in (${aCriar.map((c) => lit(c.u)).join(',')})
                                order by criado_em, utilizador;`)).map((r) => [r.utilizador, r]));
const criadas = aCriar.filter((c) => naBd.has(c.u)).map((c) => ({ ...naBd.get(c.u), codigo: c.codigo }));
for (const c of aCriar) if (!naBd.has(c.u)) console.warn(`⚠ "${c.u}" não foi criada`);

// ---- confirmar o login (função real da app, efeitos desfeitos) -----------------------
const login = new Map(rows(sql(`
  create or replace function pg_temp.testar_login(p_u text, p_pw text) returns jsonb language plpgsql as $f$
  declare r jsonb;
  begin
    begin
      r := public.entrar(p_u, p_pw);
      raise exception using errcode = 'SBX01';   -- desfaz o que entrar() escreveu
    exception when sqlstate 'SBX01' then null;
    end;
    return r;
  end $f$;
  select utilizador, r ->> 'ok' as ok, r ->> 'user_id' as user_id, r ->> 'erro' as erro
  from (select v.utilizador, pg_temp.testar_login(v.utilizador, v.pw) as r
        from (values ${aCriar.map((c) => `(${lit(c.u)}, ${lit(c.pw)})`).join(', ')}) v (utilizador, pw)) x;`))
  .map((r) => [r.utilizador, r]));

// ---- resultado ------------------------------------------------------------------
console.log(`\n${'utilizador'.padEnd(16)} ${'user_id'.padEnd(36)}  ${'criado_em'.padEnd(29)}  login`);
let falhas = 0;
for (const c of criadas) {
  const l = login.get(c.utilizador);
  const ok = l?.ok === 'true' && l.user_id === c.user_id;
  if (!ok) falhas++;
  console.log(`${c.utilizador.padEnd(16)} ${c.user_id}  ${String(c.criado_em).padEnd(29)}  ${ok ? 'ok' : `FALHOU ${l?.erro ?? ''}`}`);
}

const pasta = join(RAIZ, 'backups');
mkdirSync(pasta, { recursive: true });
const agora = new Date();
const saida = join(pasta, `contas_criadas_${agora.toISOString().slice(0, 10)}_${agora.toTimeString().slice(0, 5).replace(':', '')}.csv`);
writeFileSync(saida, ['utilizador,user_id,criado_em,codigo_recuperacao',
  ...criadas.map((c) => [c.utilizador, c.user_id, c.criado_em, c.codigo].join(','))].join('\n') + '\n');
console.log(`\n${criadas.length} criada(s); login confirmado em ${criadas.length - falhas}.`);
console.log(`Lista com os códigos de recuperação: ${saida} (privado, fora do git)`);
if (falhas) process.exit(1);
