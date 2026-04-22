# Refatoracao por Risco

Ordem recomendada para reorganizar o frontend sem quebrar o sistema.

Base usada nesta analise:

- frontend estavel em `frontend/index.html`
- mapa de globais em `GLOBAL-FUNCTIONS-MAP.md`

## Regra principal

Nunca comecar por funcao chamada direto no HTML.

A ordem segura e:

1. helpers puros
2. helpers de formatacao e normalizacao
3. helpers de render e catalogo sem entrada direta do HTML
4. funcoes de pagina chamadas por funcoes globais
5. handlers globais do HTML
6. shell principal do app

## Fase 1 - Baixo risco

Pode mover primeiro.

Caracteristicas:

- nao sao chamadas por `onclick` ou atributos inline
- nao dependem fortemente de DOM
- trabalham com string, ids, datas, arrays ou normalizacao

Boas candidatas:

- `sanitize`
- `normalizarNome`
- `normalizarTecnicosIds`
- `extrairNomesEquipeLegada`
- `parseHorarioMinuto`
- `getHorarioServicoMin`
- `formatarHoraDoDia`
- `formatarMinutosHM`
- `periodoAllLabel`
- `mesLabel`
- `svcMesMatches`
- `normId`
- `sameId`
- `escapeHtmlAttr`
- `jsArg`

Melhor uso:

- primeiro arquivo externo de utilitarios
- sem precisar expor tudo em `window`

## Fase 2 - Baixo para medio risco

Pode mover logo depois da Fase 1.

Caracteristicas:

- ainda nao entram direto pelo HTML
- ja dependem de estado do app ou de catalogos
- servem varias telas, mas sem controlar a navegacao

Boas candidatas:

- `dedupeServicesById`
- `extrairTiposServico`
- `tipoChipsHtml`
- `tipoComboLabel`
- `filteredSvcs`
- `syncMesSelects`
- `updateFooter`
- `renderTecnicos`
- `getTiposServicoCatalogo`
- `renderTiposCheckbox`
- `updateTiposPreview`
- `bindTiposPreview`

Risco principal:

- quebrar modal de novo servico ou filtros da agenda se o carregamento mudar

## Fase 3 - Medio risco

Mover so depois de validar bem as Fases 1 e 2.

Caracteristicas:

- mexem em tela, mas ainda nao sao o nucleo da navegacao
- costumam ser renderizadores ou fluxos de pagina

Boas candidatas:

- `renderDash`
- `renderFrota`
- `renderEquipes`
- `renderHist`
- `renderRotas`
- `showChangelog`
- `carregarTecnicosConfig`
- `carregarVeiculosConfig`
- `carregarTiposServicoConfig`

Risco principal:

- tela carrega, mas area interna fica vazia ou com botoes quebrados

## Fase 4 - Medio para alto risco

Mover com cuidado, mantendo global em `window`.

Caracteristicas:

- sao chamadas direto por atributos inline
- mas estao relativamente isoladas por modulo

Entram aqui:

- Configuracoes:
  `showConfigTab`, `formNovoTecnico`, `salvarTecnico`, `toggleTecnico`, `excluirTecnico`, `formNovoVeiculo`, `salvarVeiculo`, `toggleVeiculo`, `excluirVeiculo`, `abrirModalTipoServico`, `fecharModalTipoServico`, `salvarTipoServico`, `excluirTipoServico`
- Historico:
  `showCLDetail`, `saveImp`, `clearImp`
- Roteiro:
  `rotCopiarEquipe`, `rotWhatsApp`, `rotWhatsAppTudo`, `rotCopiarTudo`, `rotCopiarModal`, `rotFecharModal`

Regra:

- se sair do HTML inline, precisa continuar exposta em `window`

## Fase 5 - Alto risco

Nao mover cedo.

Caracteristicas:

- controlam modais principais
- afetam criacao, edicao e status de servicos
- afetam clientes e checklist

Nao comecar por estas:

- `openNewSvc`
- `confirmNewSvc`
- `openEditSvc`
- `salvarEdicaoSvc`
- `setSt`
- `renderAgenda`
- `renderHoje`
- `openClientModal`
- `closeClientModal`
- `saveClient`
- `deleteClient`
- `renderClientes`
- `saveCL`
- `clearCL`
- `calcKm`
- `selVeh`
- `selFuel`
- `togAv`

Risco principal:

- sistema abre, mas operacao para de funcionar

## Fase 6 - Critico

Mexer por ultimo.

Essas sao as funcoes que mais tem potencial de derrubar o app inteiro:

- `nav`
- wrapper mobile de `nav`
- `mobToggleSidebar`
- `mobCloseSidebar`
- `mobNav`
- `applyMesFilter`
- `init`
- `bindAuthEvents`
- `checkAuth`
- `selectAuthProfile`

Se quebrar aqui:

- sidebar para de funcionar
- telas nao trocam
- login nao libera o uso
- erro aparece logo ao abrir a pagina

## Ordem recomendada de extracao

Se a gente for reorganizar de novo, eu seguiria assim:

1. criar `frontend/js/utils-core.js` com Fase 1
2. validar local e online
3. criar `frontend/js/ui-helpers.js` com Fase 2
4. validar local e online
5. criar arquivos por modulo para Fase 3
6. so depois mover funcoes globais da Fase 4
7. deixar Fase 5 e Fase 6 por ultimo

## Regra operacional

Antes de mover qualquer funcao:

1. ver se ela esta em `GLOBAL-FUNCTIONS-MAP.md`
2. classificar em qual fase ela cai
3. se for Fase 4, 5 ou 6, manter em `window`
4. testar `Dashboard`, `Agenda`, `Clientes` e `Check List`
