# ControlS: em qual cartão cai cada cobrança (design curto)

## Por quê
O Sergio e o João precisam rastrear o uso dos cartões. A maior parte das assinaturas cai no cartão da
empresa (final 1234). O Backblaze B2 e os créditos da Scale Quality agora caem no cartão virtual
empresarial do Sergio (final 5678). Hoje o cartão aparece só em texto solto nas notas.

## Objetivo, não-objetivos, anti-objetivos
- Objetivo: cada serviço do ControlS diz em qual cartão é cobrado, e a tela mostra quanto cai em cada um.
- Não-objetivo: um lançamento por cobrança para bater com a fatura linha a linha (opção 2, descartada por ora).
- Anti-objetivo: o RoadS guardar dados completos de cartão. Ele guarda só o apelido, o final (4 dígitos) e o
  titular. Número completo, validade, CVV e CPF ficam só na aba Financeiro da ControlS.xlsx.

## Abordagens
1. **Cartão por serviço (escolhida pelo Sergio):** uma tabela de cartões e um campo de cartão em cada serviço.
   É rápido e responde "o que cai em cada cartão". Limitação: uma compra avulsa repetida vira uma linha só.
2. Registro de cada cobrança (data, valor, cartão, serviço): permite bater com a fatura, mas exige lançar tudo.
   Ficou para depois.
- Texto livre "cartão" no serviço foi descartado: um erro de digitação ("4793") cria um cartão fantasma nos totais.

## Desenho
- **Banco (migração 0048):**
  - tabela `payment_cards`: `id`, `label`, `last4` (exatamente 4 dígitos), `holder`, `notes`, `created_at`;
  - RLS igual à de `subscriptions`, usando `is_controls_member()`;
  - `subscriptions.payment_card_id`, com referência a `payment_cards` e `on delete set null`;
  - a migração cria os dois cartões: "Cartão da empresa" (1234, titular the company card holder) e
    "Virtual empresarial do Sergio" (5678, titular Sergio).
- **Cálculo (`subscription.ts`):**
  - `byCard(subs, cards)` soma o mensal (anual/12), o anual e o avulso de cada cartão e conta os serviços;
  - conta só os ativos, como os totais do topo, e mantém um grupo "Sem cartão informado";
  - a soma dos grupos é igual aos totais do topo, e isso é testado.
- **Tela:**
  - painel "Por cartão" ao lado dos gráficos: uma linha por cartão (apelido •••• final, titular, mensal, anual,
    avulso, nº de serviços); clicar numa linha filtra a tabela por aquele cartão;
  - coluna "Cartão" na tabela, ordenável;
  - campo "Cartão" no formulário, para escolher na lista ou deixar sem informar;
  - um bloco pequeno "Cartões" para cadastrar ou editar (apelido, final, titular), sem apagar cartão que esteja em uso.
- **Dados iniciais (com prova):**
  - 1234: ChatGPT, Claude Team, Claude Max, créditos Claude e Claude Pro (recibos com "final 1234");
  - 5678: Backblaze B2 e Scale Quality, conforme o Sergio;
  - os demais ficam "Sem cartão informado" até a conferência semanal achar a prova.
- **Planilha:** a aba Assinaturas da ControlS.xlsx ganha a coluna O "Cartão" ("final 1234" / "final 5678"), no fim,
  para não mexer nas colunas que a tarefa semanal já usa. Os mesmos dados iniciais vão para essa coluna.
- **Tarefa semanal:** o prompt de `controls-conferencia-semanal` passa a conferir o cartão de cada cobrança, pelo
  final que aparece no recibo ou no painel, e a manter iguais o RoadS e a coluna O.

## Fica para quem constrói
Textos da tela (seguindo `src/lib/text/controls.ts`), o lugar exato do painel no layout, as server actions dos
cartões no mesmo padrão das de assinaturas, os testes de `byCard` e de ordenação pela coluna nova.
Publicar em produção (merge e deploy) só com o OK do Sergio.
