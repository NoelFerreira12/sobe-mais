# Sobe+

Web app mobile-first que incentiva estudantes e funcionários da Universidade da Madeira (UMa) a usar as escadas em vez do elevador. Projeto de Persuasive Computing.

Cada piso tem um QR code. A pessoa lê o QR do piso onde está, sobe e lê o QR do piso onde chega, e a subida conta. Não há app para instalar nem conta.

- Site: https://noelferreira12.github.io/sobe-mais/
- Painel do docente: https://noelferreira12.github.io/sobe-mais/painel/
- Cartazes para imprimir: https://noelferreira12.github.io/sobe-mais/cartazes/

## Como funciona

| Parte | Tecnologia |
|---|---|
| Frontend | HTML, CSS e JavaScript (ES modules), sem framework nem build, no GitHub Pages |
| Backend | Supabase (Postgres, plano Free). Toda a validação corre no servidor, em funções SQL (RPC) |
| QR codes | `npm run qr` (pacote `qrcode`): SVG + PNG por piso |

### Fluxo de uma subida

1. Cada QR aponta para `…/s/?p=<token>`. O token é aleatório e único por piso, e só existe na base de dados (não está no repositório).
2. Na primeira visita aparece o aviso de privacidade. Ao aceitar, o telemóvel gera um ID anónimo (UUID), que fica em cookie e em localStorage.
3. No primeiro scan, o servidor sorteia a variante A ou B (50/50). A variante desse ID nunca muda.
4. Cada scan fica gravado com o ID anónimo, o token, o piso, a variante e a hora do servidor.
5. Uma subida é válida quando há um scan num piso seguido de um scan num piso **mais alto**, com 12 a 180 segundos **por andar** subido. Descer não conta. O piso de chegada serve também de início para a próxima subida. Depois de uma subida válida, as subidas desse ID só voltam a contar passados 5 min. Os scans que não cumprem as regras ficam guardados, mas não contam.

### Teste A/B

A **única** diferença entre as versões é o ecrã que aparece depois de uma subida válida:

- **A**: barra coletiva da UMa até ao Pico Ruivo (1862 m), com os metros totais e o próximo marco (Cabo Girão 580 m, Encumeada 1007 m, Pico do Arieiro 1818 m, Pico Ruivo 1862 m). Quando se chega ao topo, a contagem recomeça (2.ª subida).
- **B**: só o contador pessoal (subidas, andares, metros).

O servidor só envia os números coletivos às respostas da versão A. As páginas comuns (início, estado, meta, sequência, medalhas) não mostram números coletivos a ninguém, e o ecrã inicial nem fala do Pico Ruivo, para não contaminar a versão B.

### Base de dados

Ficheiro: `supabase/migrations/20261113000000_schema.sql`.

- Tabelas: `config`, `pisos`, `participantes`, `scans`, `painel_tentativas`. Têm RLS ativo e nenhuma política, e as permissões foram retiradas a `anon`/`authenticated`: a chave pública só consegue chamar as RPC.
- RPC: `registar_scan`, `estado_utilizador`, `progresso_coletivo`, `definir_meta`, `painel` (password), `pisos_qr` (password).
- A base de dados guarda pisos/andares, não metros. Os metros calculam-se sempre com as alturas atuais do `config.js`.
- Rate limit por ID: no mínimo 2 s entre scans e no máximo 60 scans por hora.
- O workflow `.github/workflows/manter-ativo.yml` chama `progresso_coletivo()` uma vez por dia, para o plano Free não pausar o projeto.

## Configuração

Tudo em [`config.js`](config.js).

### Mudar a altura dos andares

Edita `alturaLanco`. Cada lanço é identificado pelo piso de baixo (`'-3'` é o lanço do piso -3 ao -2):

```js
alturaLanco: { '-3': 3.2, '-2': 3, '-1': 3, '0': 4.1, '1': 3.5, '2': 3.5 },
```

Faz commit e push. Todos os metros (pessoais e coletivos) são recalculados logo, incluindo os das subidas antigas.

### Mudar os tempos (mín./máx. por andar, intervalo entre subidas, datas do estudo)

Quem decide é o servidor (tabela `public.config`). Edita `config.js` e envia para a base de dados:

```bash
npm run config:sync
```

Também podes mudar valores diretamente:

```bash
supabase db query --remote --yes "update public.config set valor = '15' where chave = 'min_seg_por_andar'"
```

| Chave | Valor por defeito |
|---|---|
| `min_seg_por_andar` | 12 |
| `max_seg_por_andar` | 180 |
| `cooldown_seg` | 300 |
| `estudo_inicio` / `estudo_fim` | 2026-11-16 / 2026-12-08 (inclusive, hora da Madeira) |

Os scans feitos fora destas datas continuam a ser aceites, mas ficam marcados como fora do estudo (`no_estudo = false`) e o painel não os conta.

### Comparação escada vs. elevador

`tempoEscadaPorAndarSeg` e `esperaElevadorSeg` em `config.js`. Aparecem no ecrã inicial e nos cartazes.

## Imprimir os cartazes

1. Abre https://noelferreira12.github.io/sobe-mais/cartazes/ e entra com a password do painel.
2. Em cada cartaz, escolhe a direção da seta (para onde ficam as escadas nesse piso).
3. Carrega em **Imprimir 7 cartazes**. Na janela de impressão escolhe papel A4, margens "Nenhuma", escala 100% e ativa "Gráficos de fundo".
4. Antes de colar, testa cada QR com o telemóvel. O código pequeno no canto (ex.: `SM-M3 · Piso -3`) diz-te em que piso vai cada cartaz.

Para ter só os QR em ficheiro (SVG + PNG de 2400 px, correção de erro M):

```bash
npm install
npm run qr            # usa PAINEL_PASSWORD do .env, ou: npm run qr -- <password>
```

Os ficheiros ficam em `qrcodes/`. Esta pasta está no `.gitignore` porque os QR contêm os tokens secretos.

## Desenvolvimento

```bash
npm install
npm run servir        # http://localhost:8080
npm run testar        # testa o fluxo completo contra o Supabase real (~3,5 min) e apaga os IDs de teste
npm run password      # gera uma nova password do painel (guardada em .env)
```

Os scripts de administração usam o Supabase CLI (`supabase login` + `supabase link --project-ref <ref>`).

O ficheiro `.env` (fora do git) guarda a password da base de dados e a do painel. A chave publicada em `config.js` é a chave pública (publishable/anon), protegida por RLS. A service role key nunca entra no repositório.

## Ética

- Participação voluntária, sem contas nem dados pessoais. Só se guarda um ID anónimo aleatório e a hora dos scans.
- Não há rankings individuais. As medalhas premeiam a regularidade, não a quantidade.
- Nenhuma mensagem envergonha quem usa o elevador nem incentiva a subir à pressa. Quem precisa do elevador deve usá-lo.
