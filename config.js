// =====================================================================
// Sobe+ — configuração do site
// Edita este ficheiro, faz commit e push. O GitHub Pages atualiza sozinho.
// =====================================================================
export const CONFIG = {
  // Supabase (a anon key é pública: as tabelas estão protegidas por RLS e
  // a chave só consegue chamar as funções RPC).
  supabaseUrl: 'https://glwypevlnftqojeupneu.supabase.co',
  supabaseKey: 'sb_publishable_3qOoRY7AMESWoSO6Phz4Ew_bBY_PHfi',

  // Endereço público do site (usado nos QR codes).
  siteUrl: 'https://noelferreira12.github.io/sobe-mais',

  pisos: [-3, -2, -1, 0, 1, 2, 3],

  // Altura (m) de cada lanço, identificado pelo piso de BAIXO.
  // '-3' = do piso -3 ao -2, '2' = do piso 2 ao 3.
  // A base de dados guarda os andares subidos, por isso mudar aqui
  // recalcula logo todos os metros (pessoais e coletivos).
  alturaLanco: { '-3': 3, '-2': 3, '-1': 3, '0': 3, '1': 3, '2': 3 },

  // Regras da subida. Quem decide é o servidor (tabela public.config).
  // Se mudares estes valores, corre `npm run config:sync` para os enviar
  // para a base de dados.
  minSegPorAndar: 12,   // menos do que isto por andar = "rápido demais"
  maxSegPorAndar: 180,  // mais do que isto por andar = "passou muito tempo"
  cooldownSeg: 300,     // depois de uma subida válida, só volta a contar passado isto

  // Comparação mostrada no ecrã inicial e nos cartazes.
  tempoEscadaPorAndarSeg: 15, // quanto demora subir 1 andar a pé, com calma
  esperaElevadorSeg: 60,      // espera típica pelo elevador

  // ---------------------------------------------------------------
  // Rotas pela Madeira. Altitudes em metros (fontes: Visit Madeira,
  // geodiversidade.madeira.gov.pt; "≈" = valor aproximado).
  // Ao chegar ao topo, a contagem recomeça (2.ª subida, 3.ª, ...).
  // ---------------------------------------------------------------

  // Versão A — objetivo GLOBAL: os metros de toda a UMa juntos.
  rotaColetiva: {
    titulo: 'A UMa a subir o Pico Ruivo',
    marcos: [
      { nome: 'Fortaleza do Pico', altitude: 111 },
      { nome: 'Pico do Facho', altitude: 280 },
      { nome: 'Farol da Ponta do Pargo', altitude: 312 },
      { nome: 'Pico dos Barcelos', altitude: 355 },
      { nome: 'Cabo Girão', altitude: 580 },
      { nome: 'Ribeiro Frio', altitude: 900 },        // ≈
      { nome: 'Encumeada', altitude: 1007 },
      { nome: 'Achada do Teixeira', altitude: 1600 }, // ≈
      { nome: 'Pico do Arieiro', altitude: 1818 },
      { nome: 'Pico Ruivo', altitude: 1862 },          // topo (último da lista)
    ],
  },

  // Versão B — objetivo INDIVIDUAL: só os metros da própria pessoa.
  // Escala pessoal (alguém que sobe 2 andares 2× por dia faz ≈ 60 m/semana).
  rotaIndividual: {
    titulo: 'A tua subida ao Cabo Girão',
    marcos: [
      { nome: 'Fortaleza do Pico', altitude: 111 },
      { nome: 'Pico do Facho', altitude: 280 },
      { nome: 'Miradouro do Pináculo', altitude: 283 },
      { nome: 'Farol da Ponta do Pargo', altitude: 312 },
      { nome: 'Pico dos Barcelos', altitude: 355 },
      { nome: 'Cabo Girão', altitude: 580 },           // topo (último da lista)
    ],
  },

  // Estudo (datas inclusivas, hora da Madeira). Também em public.config.
  estudo: { inicio: '2026-11-13', fim: '2026-12-08' },
  objetivoParticipantes: 60,
  minimoParticipantes: 30,
};
