// npm run versao — marca todos os ficheiros .js/.css do site com uma versão nova (?v=...).
// O GitHub Pages guarda os ficheiros em cache 10 min; sem isto, logo depois de uma
// atualização um telemóvel podia juntar código antigo e novo e a página falhar.
// Corre antes de cada commit que mude o site.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { RAIZ } from './lib.mjs';

const versao = process.argv[2] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const IGNORAR = new Set(['node_modules', '.git', 'scripts', 'supabase', 'qrcodes', 'backups', '.github']);
// Caminhos relativos locais terminados em .js/.css (imports, src, href), com ou sem ?v= anterior.
const RE = /(['"])(\.{1,2}\/[^'"\s]*?\.(?:js|css))(?:\?v=[\w-]+)?\1/g;

const ficheiros = [];
(function percorrer(dir) {
  for (const n of readdirSync(dir)) {
    if (IGNORAR.has(n)) continue;
    const c = join(dir, n);
    if (statSync(c).isDirectory()) percorrer(c);
    else if (['.html', '.js'].includes(extname(n))) ficheiros.push(c);
  }
}(RAIZ));

let alterados = 0;
for (const f of ficheiros) {
  const antes = readFileSync(f, 'utf8');
  const depois = antes.replace(RE, (_, q, caminho) => `${q}${caminho}?v=${versao}${q}`);
  if (depois !== antes) { writeFileSync(f, depois); alterados++; }
}
console.log(`Versão ${versao} aplicada em ${alterados} ficheiros.`);
