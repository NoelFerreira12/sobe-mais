// npm run qr — gera um SVG e um PNG (alta resolução, correção de erro M) por piso em /qrcodes.
// Os tokens vêm da base de dados (função pisos_qr, protegida pela password do painel),
// por isso nunca ficam no repositório. A pasta /qrcodes está no .gitignore.
import QRCode from 'qrcode';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, RAIZ, env, rpc } from './lib.mjs';

const password = process.argv[2] || env('PAINEL_PASSWORD');
if (!password) {
  console.error('Falta a password do painel: npm run qr -- <password>  (ou PAINEL_PASSWORD no .env)');
  process.exit(1);
}

const r = await rpc('pisos_qr', { p_password: password });
if (!r.ok) { console.error(`Erro: ${r.erro}`); process.exit(1); }

const pasta = join(RAIZ, 'qrcodes');
mkdirSync(pasta, { recursive: true });
const opcoes = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#FFFFFF' } };
const lista = [];

for (const p of r.pisos) {
  const url = `${CONFIG.siteUrl}/s/?p=${encodeURIComponent(p.token)}`;
  const nome = `piso_${p.piso < 0 ? 'm' : ''}${Math.abs(p.piso)}_${p.codigo}`;
  writeFileSync(join(pasta, `${nome}.svg`), await QRCode.toString(url, { ...opcoes, type: 'svg' }));
  await QRCode.toFile(join(pasta, `${nome}.png`), url, { ...opcoes, type: 'png', width: 2400 });
  lista.push({ piso: p.piso, codigo: p.codigo, ficheiro: nome, url });
  console.log(`Piso ${String(p.piso).padStart(2)}  ${p.codigo}  ${nome}.svg / .png`);
}
writeFileSync(join(pasta, 'pisos.json'), JSON.stringify(lista, null, 2));
console.log(`\n${lista.length} QR gerados em ${pasta}`);
