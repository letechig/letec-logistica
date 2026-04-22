# Global Functions Map

Mapa das funcoes que precisam continuar globais no frontend atual.

## Fonte de verdade hoje

- Frontend estavel: `frontend/index.html`
- O JavaScript principal esta inline dentro de `frontend/index.html`
- Antes de qualquer nova refatoracao, trate `frontend/index.html` como a fonte oficial

## Regra importante

Se uma funcao e chamada por:

- `onclick`
- `onchange`
- `oninput`
- `onblur`
- HTML montado por template string com `onclick="..."`

ela precisa continuar acessivel no escopo global.

Hoje isso acontece porque as funcoes estao declaradas no script inline do `index.html`.

## Funcoes mais criticas

Essas sao as mais sensiveis e causam quebra ampla se sumirem:

- `nav` em `frontend/index.html:3427` e wrapper em `frontend/index.html:8436`
- `openNewSvc` em `frontend/index.html:6521`
- `openEditSvc` em `frontend/index.html:4543`
- `setSt` em `frontend/index.html:4522`
- `openClientModal` em `frontend/index.html:5848`
- `saveClient` em `frontend/index.html:6073`
- `closeClientModal` em `frontend/index.html:5936`
- `renderAgenda` em `frontend/index.html:3926`
- `renderClientes` em `frontend/index.html:5747`
- `saveCL` em `frontend/index.html:5569`

## Navegacao e shell

- `nav` `3427` e `8436`
- `mobToggleSidebar` `8400`
- `mobCloseSidebar` `8407`
- `mobNav` `8413`
- `applyMesFilter` `3456`
- `dashSetMes` `3467`
- `showChangelog` `7776`
- `showConfigTab` `8159`
- `exportCSV` `6837`
- `selectAuthProfile` `6664`

## Agenda, calendario e servicos

- `renderAgenda` `3926`
- `agSetView` `3824`
- `agToggleFilters` `8446`
- `openNewSvc` `6521`
- `openNewSvcData` `4454`
- `openEditSvc` `4543`
- `salvarEdicaoSvc` `4649`
- `setSt` `4522`
- `showDayDetail` `4330`
- `showSvcDetail` `4540`
- `confirmNewSvc` `6565`
- `calNav` `3805`
- `calIrParaHoje` `3811`
- `irParaDia` `4462`
- `irParaRoteiro` `4469`

## Painel do dia, roteiro e rotas

- `renderHoje` `4904`
- `hojeMoverDia` `4887`
- `hojeIrParaHoje` `4895`
- `hojeExecTodos` `5258`
- `rotGerarDoSistema` `7269`
- `rotWhatsAppTudo` `7478`
- `rotCopiarTudo` `7485`
- `rotCopiarEquipe` `7463`
- `rotWhatsApp` `7471`
- `rotFecharModal` `7507`
- `rotCopiarModal` `7506`
- `renderRotas` `5299`

## Check list, frota e historico

- `selVeh` `5551`
- `selFuel` `5552`
- `togAv` `5553`
- `calcKm` `5554`
- `chkAll` `5567`
- `unchkAll` `5568`
- `saveCL` `5569`
- `clearCL` `5593`
- `saveImp` `6495`
- `clearImp` `6516`
- `showCLDetail` `6471`
- `renderHist` `6441`

## Clientes e duplicatas

- `renderClientes` `5747`
- `openClientModal` `5848`
- `closeClientModal` `5936`
- `buscarCepCliente` `5944`
- `loadClientHistory` `6031`
- `togglePeriodicidade` `6184`
- `geocodeClientAddress` `6211`
- `saveClient` `6073`
- `deleteClient` `6392`
- `openServiceFromClient` `5809`
- `openDuplicatesModal` `6268`
- `closeDuplicatesModal` `6273`
- `loadDuplicates` `6277`
- `selectGeocodeSuggestion` `6259`
- `mergeDuplicates` `6346`
- `deleteClientDirectly` `6415`

## Configuracoes e cadastros

- `abrirModalTipoServico` `8290`
- `fecharModalTipoServico` `8331`
- `salvarTipoServico` `8336`
- `excluirTipoServico` `8379`
- `formNovoTecnico` `8197`
- `salvarTecnico` `8198`
- `toggleTecnico` `8203`
- `excluirTecnico` `8204`
- `formNovoVeiculo` `8236`
- `salvarVeiculo` `8237`
- `toggleVeiculo` `8243`
- `excluirVeiculo` `8244`

## Edicao de equipe

- `abrirEdicaoEquipe` `7817`
- `salvarEdicaoEquipe` `7863`

## Nao entram no mapa de globais do app

Esses aparecem em atributos inline, mas nao sao funcoes globais do sistema:

- `event.stopPropagation`
- `document.getElementById(...)`
- `setTimeout(...)`

## Como usar este mapa

Antes de mover JavaScript para arquivo externo:

1. confirme se a funcao esta nesta lista
2. confirme se ela continua acessivel em `window`
3. teste `Dashboard`, `Agenda`, `Clientes` e `Check List`
