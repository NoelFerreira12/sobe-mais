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

  // Montanha virtual (só aparece na versão A).
  topo: { nome: 'Pico Ruivo', altitude: 1862 },
  marcos: [
    { nome: 'Cabo Girão', altitude: 580 },
    { nome: 'Encumeada', altitude: 1007 },
    { nome: 'Pico do Arieiro', altitude: 1818 },
    { nome: 'Pico Ruivo', altitude: 1862 },
  ],

  // Estudo (datas inclusivas, hora da Madeira). Também em public.config.
  estudo: { inicio: '2026-11-16', fim: '2026-12-08' },
  objetivoParticipantes: 60,
  minimoParticipantes: 30,
};
