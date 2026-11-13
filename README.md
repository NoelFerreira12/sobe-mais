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

### Ler o QR dentro ou fora da app

As duas formas contam da mesma maneira, porque o token segue sempre o mesmo caminho até ao servidor:

- **Fora da app:** com a app da câmara do telemóvel, que abre o link `…/s/?p=<token>`.
- **Dentro da app:** com o botão "Ler QR do piso", no ecrã inicial e em todos os ecrãs de `/s/`. A câmara abre dentro da página. Usa o `BarcodeDetector` nativo quando existe (Android/Chrome) e o [jsQR](https://github.com/cozmo/jsQR) nos restantes browsers (iPhone/Safari). QR que não sejam do Sobe+ são ignorados.

O site tem um `manifest.webmanifest`, por isso pode ser instalado no telemóvel ("Adicionar ao ecrã principal"). Fica com ícone próprio, abre em ecrã inteiro e começa no ecrã de progresso, com o botão de leitura.

### Teste A/B

Há dois tipos de utilizadores, sorteados ao acaso (50/50) no primeiro scan. A **única** diferença entre eles é o ecrã que aparece depois de uma subida válida:

- **A · objetivo global:** "A UMa a subir o Pico Ruivo". Uma barra com os metros de **todos** os participantes juntos e metas intermédias da Madeira:

  Fortaleza do Pico 111 m · Pico do Facho 280 m · Farol da Ponta do Pargo 312 m · Pico dos Barcelos 355 m · Cabo Girão 580 m · Ribeiro Frio ≈ 900 m · Encumeada 1007 m · Achada do Teixeira ≈ 1600 m · Pico do Arieiro 1818 m · **Pico Ruivo 1862 m**

- **B · objetivo individual:** "A tua subida ao Cabo Girão". A mesma apresentação (barra, metas da Madeira, próxima meta), mas só com os metros **da própria pessoa** e numa escala pessoal, mais o contador pessoal (subidas, andares, metros):

  Fortaleza do Pico 111 m · Pico do Facho 280 m · Miradouro do Pináculo 283 m · Farol da Ponta do Pargo 312 m · Pico dos Barcelos 355 m · **Cabo Girão 580 m**

Ao chegar ao topo, a contagem recomeça (2.ª subida) e o ecrã indica-o. Quando se passa uma meta intermédia, aparece um destaque ("Chegaste ao Pico do Facho!" / "A UMa chegou ao Pico do Facho!").
As rotas e as altitudes estão em `config.js` (`rotaColetiva`, `rotaIndividual`). Fontes das altitudes: Visit Madeira e geodiversidade.madeira.gov.pt. Os valores com ≈ são aproximados.

O servidor só envia os números coletivos às respostas da versão A. As páginas comuns (início, progresso, meta, sequência, medalhas) não mostram números coletivos a ninguém. O painel compara os dois grupos para ver qual consegue melhor resultado.

### Contas (login opcional)

No primeiro QR, a pessoa escolhe entre duas opções:

- **Criar conta / entrar:** **nome de utilizador (alcunha) + palavra-passe**, sem email. Entra no teste A/B (sorteio 50/50) e pode continuar o progresso noutro telemóvel. Cada pessoa conta como um só participante.
- **Continuar sem conta:** fica só com um ID anónimo no telemóvel (variante `G`). As subidas **contam para o total coletivo da UMa**, mas a pessoa não entra na comparação A/B. Depois de uma subida válida vê só "Esta subida conta para o total da UMa", sem números (nem coletivos nem pessoais), para não contaminar o teste se mais tarde criar conta e lhe calhar a versão B. Pode criar conta a qualquer momento.

**Recuperação sem email.** Ao criar a conta, a pessoa recebe um **código de recuperação** (ex.: `3373-6V8A-QGGE`), que aparece uma única vez. Em "Já tenho conta → Esqueci-me da palavra-passe", com a alcunha e o código, escolhe uma palavra-passe nova e recebe um código novo (o antigo deixa de valer). Com a sessão iniciada, também pode gerar um código novo em "Novo código de recuperação".

**Alcunhas únicas.** Não há duas contas com a mesma alcunha (`contas.utilizador` é `UNIQUE` e guardado sempre em minúsculas, por isso `Noel` = `noel`). Se a alcunha já existir, a app sugere 3 nomes livres (ex.: `noel.uma`, `noel_22`, `noel81`) para a pessoa tocar e usar.

Segurança:

- Palavras-passe e códigos guardados com bcrypt (`pgcrypto`).
- Bloqueio de 15 min após 10 tentativas falhadas por nome (login e recuperação).
- O painel e o CSV nunca mostram os nomes de utilizador, só pseudónimos (P001, …). Quem não tem conta aparece num cartão à parte e numa coluna própria no CSV diário.

### Base de dados

Ficheiro: `supabase/migrations/20261113000000_schema.sql`.

- Tabelas: `config`, `pisos`, `contas`, `login_tentativas`, `participantes`, `scans`, `painel_tentativas`. Têm RLS ativo e nenhuma política, e as permissões foram retiradas a `anon`/`authenticated`: a chave pública só consegue chamar as RPC.
- RPC: `criar_conta`, `entrar`, `recuperar_conta`, `novo_codigo_recuperacao`, `registar_scan`, `estado_utilizador`, `progresso_coletivo`, `definir_meta`, `painel` (password), `pisos_qr` (password).
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

## Custos

| Serviço | Plano | Custo |
|---|---|---|
| GitHub Pages (site) | grátis em repositórios públicos | 0 € |
| GitHub Actions (keep-alive diário) | grátis em repositórios públicos | 0 € |
| Supabase (base de dados) | Free: 500 MB, 5 GB de tráfego/mês, pausa após 7 dias sem atividade | 0 € |
| Bibliotecas (jsQR, qrcode-generator, Google Fonts) | CDN públicas | 0 € |

Para este estudo (cerca de 60 pessoas, alguns milhares de scans), o uso fica muito abaixo dos limites gratuitos. Cada scan ocupa menos de 1 KB.
Só seria preciso pagar para ter um domínio próprio (cerca de 10 €/ano, opcional) ou o Supabase Pro (cerca de 25 $/mês, que não pausa e faz backups diários). Nenhum dos dois é necessário.

## Ética

- Participação voluntária. A conta é opcional e tem só uma alcunha e uma palavra-passe (sem email). Nos dados do estudo, cada pessoa é um ID anónimo, com a hora dos scans.
- Não há rankings individuais. As medalhas premeiam a regularidade, não a quantidade.
- Nenhuma mensagem envergonha quem usa o elevador nem incentiva a subir à pressa. Quem precisa do elevador deve usá-lo.
