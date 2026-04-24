# Auditoria tecnica: `frontend/index.html`

Data da auditoria: 2026-04-24

Atualizacao da etapa 1: os IDs duplicados `tecnicos-container` e `tipos-container` foram corrigidos em `frontend/index.html`; a checagem estatica passou a retornar `duplicate ids 0`.

## Resumo executivo

Esta auditoria trata `frontend/index.html` como a fonte oficial do frontend. Os arquivos `letec_v76_auditado.html`, `frontend/js/app.js` e `frontend/js/api.js` foram considerados somente como comparacao e risco de deriva.

O arquivo oficial passa em uma checagem basica de sintaxe dos scripts inline, e os handlers inline principais (`onclick`, `onchange`, `oninput`, `onblur`) nao apontam para funcoes globais ausentes. Os riscos mais relevantes encontrados sao duplicacao de IDs no DOM, divergencia entre o HTML oficial e os arquivos JS externos, codigo legado aparentemente orfao, e alteracoes locais ja existentes em `frontend/index.html` que removem o antigo modal de roteiro.

Estado inicial observado:

- `frontend/index.html` ja estava modificado antes desta auditoria.
- `git diff --stat -- frontend/index.html`: `109` linhas alteradas, com `41 insertions(+)` e `68 deletions(-)`.
- Aviso do Git observado: `LF will be replaced by CRLF the next time Git touches it`.

## Validacoes executadas

- Parsing dos scripts inline com `new Function`.
  - `inline scripts 2`
  - `script 1 OK 11034`
  - `script 2 OK 318845`
- Checagem estatica de IDs duplicados.
  - `3 tecnicos-container`
  - `2 tipos-container`
- Checagem de handlers inline contra funcoes globais declaradas.
  - `inline calls 77`
  - `missing raw 1 if`
  - `missing app funcs` vazio
- Inspecao de carregamento de scripts.
  - O HTML carrega Supabase por CDN em `frontend/index.html:871`.
  - Existem dois scripts inline em `frontend/index.html:872` e `frontend/index.html:2161`.
  - Nao ha referencia carregando `frontend/js/app.js` ou `frontend/js/api.js`.

## Achados

### HTML/DOM

#### Medio: IDs duplicados em containers de tecnicos e tipos

- Local:
  - `frontend/index.html:4576` usa `id="tipos-container"`.
  - `frontend/index.html:4591` usa `id="tecnicos-container"`.
  - `frontend/index.html:6509` usa `id="tipos-container"`.
  - `frontend/index.html:6512` usa `id="tecnicos-container"`.
  - `frontend/index.html:7801` usa `id="tecnicos-container"`.
- Evidencia: checagem estatica encontrou `tecnicos-container` 3 vezes e `tipos-container` 2 vezes.
- Impacto provavel: qualquer uso de `document.getElementById('tecnicos-container')` ou `document.getElementById('tipos-container')` pega apenas o primeiro elemento encontrado no DOM. Isso pode preencher checkboxes no modal errado, principalmente entre edicao de servico, novo servico e edicao de equipe.
- Recomendacao: trocar IDs por nomes especificos por contexto, por exemplo `ed-tecnicos-container`, `ns-tecnicos-container`, `eq-tecnicos-container`, `ed-tipos-container` e `ns-tipos-container`, atualizando as funcoes que populam esses containers.
- Status: corrigido na etapa 1 com IDs especificos por contexto: `ed-*`, `ns-*` e `eq-*`.
- Seguro corrigir agora: concluido; ainda recomenda teste manual em editar servico, novo servico e editar equipe.

### Funcoes globais e handlers

#### Baixo: falso positivo conhecido em handler inline com `if(...)`

- Local: handlers inline de modal usam expressao iniciada com `if`, por exemplo padrao `onclick="if(event.target===event.currentTarget)..."`.
- Evidencia: a checagem automatica encontrou `missing raw 1 if`, mas `missing app funcs` ficou vazio.
- Impacto provavel: nenhum impacto funcional. Isso e limitacao da regex usada na auditoria, nao erro do app.
- Recomendacao: manter o registro como excecao conhecida nas proximas auditorias.
- Seguro corrigir agora: nao precisa correcao.

#### Medio: `openServiceFromClient()` substitui temporariamente `openNewSvc`

- Local:
  - `frontend/index.html:5794` define `openServiceFromClient(clientId)`.
  - `frontend/index.html:5802` salva `originalOpenNewSvc`.
  - `frontend/index.html:5803` sobrescreve `openNewSvc`.
  - `frontend/index.html:5830` restaura `openNewSvc`.
- Evidencia: a funcao altera uma funcao global para pre-preencher o modal de novo servico.
- Impacto provavel: a abordagem funciona em fluxo feliz, mas e fragil. Se `openNewSvc()` passar a ser assincrona, disparar erro, ou abrir outro fluxo aninhado, a funcao global pode ficar em estado inesperado ou o preenchimento pode falhar.
- Recomendacao: transformar `openNewSvc` para aceitar parametros opcionais de preenchimento, por exemplo `openNewSvc({ cliente, endereco, focoData: true })`, removendo a sobrescrita temporaria.
- Seguro corrigir agora: sim, mas deve ser tratado como refatoracao pequena e testado em Clientes -> criar servico.

### Duplicacoes

#### Medio: fonte oficial inline diverge de arquivos JS externos

- Local:
  - `frontend/index.html:872` e `frontend/index.html:2161` contem os scripts que rodam no app.
  - `frontend/js/app.js` existe com tamanho aproximado de `318651` bytes.
  - `frontend/js/api.js` existe com tamanho aproximado de `5737` bytes.
- Evidencia: `frontend/index.html` nao referencia `frontend/js/app.js` nem `frontend/js/api.js`; a busca por `js/app.js` e `js/api.js` no HTML nao retornou carregamentos ativos.
- Impacto provavel: correcoes feitas em `frontend/js/app.js` ou `frontend/js/api.js` nao chegam ao usuario se o app servido continuar sendo `frontend/index.html`. Isso aumenta risco de corrigir o arquivo errado.
- Recomendacao: documentar `frontend/index.html` como fonte unica ate uma refatoracao formal. Em uma etapa posterior, decidir entre remover arquivos JS nao usados ou migrar o HTML para carrega-los de fato.
- Seguro corrigir agora: nao como parte deste relatorio. Depende de decisao de arquitetura.

### Codigo morto ou legado

#### Baixo: funcoes com uma unica referencia podem ser legado

- Local:
  - `frontend/index.html:2418` define `extrairTecnicos(servico)`.
  - `frontend/index.html:2732` define `calcularTempoServicoLegacy(servico)`.
  - `frontend/index.html:3118` define `getSvcs()`.
  - `frontend/index.html:3119` define `getCLs()`.
- Evidencia: busca estatica por referencias encontrou apenas a propria definicao dessas funcoes.
- Impacto provavel: baixo no runtime atual. Elas podem existir para compatibilidade manual/debug, mas tambem podem confundir manutencao e mascarar codigo antigo.
- Recomendacao: antes de remover, confirmar se sao chamadas pelo console, por testes externos ou por HTML gerado dinamicamente que a busca estatica nao detecta. Se nao houver uso externo, remover ou mover para uma secao marcada como legado/debug.
- Seguro corrigir agora: depende de confirmacao. Nao remover sem validar uso operacional.

### Alteracoes locais ja existentes

#### Medio: `rot-modal` foi removido nas mudancas locais atuais

- Local:
  - O diff atual remove o bloco `<!-- MODAL ROTEIRO WHATSAPP -->`.
  - As funcoes atuais de roteiro direto permanecem em `frontend/index.html:7456`, `frontend/index.html:7463` e `frontend/index.html:7470`.
- Evidencia: `Select-String` nao encontrou `rot-modal` no arquivo atual; o diff mostra a remocao do modal com `rot-modal-title`, `rot-modal-txt`, botao copiar e botao fechar.
- Impacto provavel: se alguma parte do app ainda tentar abrir o modal antigo, o fluxo quebrara por elemento inexistente. Na leitura atual, o roteiro parece usar copia direta e abertura de WhatsApp por link, entao a remocao pode ser intencional.
- Recomendacao: validar manualmente Roteiro do Dia -> Gerar Roteiro -> Copiar equipe -> WhatsApp equipe -> Enviar tudo -> Copiar tudo. Se tudo funcionar, registrar a remocao como limpeza concluida.
- Seguro corrigir agora: nao requer correcao imediata se o fluxo atual estiver funcionando; requer teste manual.

#### Baixo: `confirmAction()` centraliza confirmacoes nativas

- Local:
  - `frontend/index.html:6832` define `confirmAction(message)`.
  - Chamadas aparecem em exclusoes, mesclagem de duplicatas e marcar todos como executados.
- Evidencia: chamadas em `frontend/index.html:5245`, `frontend/index.html:6005`, `frontend/index.html:6348`, `frontend/index.html:6379`, `frontend/index.html:6778`, `frontend/index.html:8177`, `frontend/index.html:8217` e `frontend/index.html:8353`.
- Impacto provavel: baixo. Hoje `confirmAction()` apenas delega para `window.confirm`, entao o comportamento funcional deve ser equivalente ao `confirm()` anterior.
- Recomendacao: manter como ponto de extensao se a intencao for substituir confirmacoes nativas por modal proprio no futuro. Se nao houver plano, registrar em comentario curto para evitar confusao.
- Seguro corrigir agora: nao precisa correcao.

### Risco de refatoracao futura

#### Alto: funcoes chamadas por atributos inline precisam continuar globais

- Local: `frontend/index.html` usa 77 handlers inline.
- Evidencia: `GLOBAL-FUNCTIONS-MAP.md` ja documenta que funcoes chamadas por `onclick`, `onchange`, `oninput` e `onblur` precisam continuar acessiveis no escopo global.
- Impacto provavel: alto em qualquer tentativa de mover JavaScript para `frontend/js/app.js` com escopo de modulo. Se as funcoes deixarem de estar em `window`, botoes e filtros param silenciosamente.
- Recomendacao: antes de qualquer extracao para arquivo externo, criar uma lista automatizada de funcoes globais obrigatorias e expor explicitamente em `window`, ou substituir handlers inline por `addEventListener` em uma migracao controlada.
- Seguro corrigir agora: nao dentro deste relatorio. Deve virar plano separado de refatoracao.

## Conferencia manual recomendada

Executar estes fluxos no navegador depois de qualquer correcao:

- Dashboard: carregar app, verificar cards, badges e troca de mes.
- Agenda: alternar Lista, Quadro e Por Data; abrir novo servico; editar servico existente; conferir tipos e tecnicos.
- Clientes: buscar cliente, abrir cliente, criar servico a partir de cliente, gerenciar duplicatas.
- Check List: selecionar veiculo, combustivel, itens, salvar registro e conferir historico.
- Roteiro do Dia: gerar roteiro, copiar por equipe, abrir WhatsApp por equipe, enviar/copiar tudo.

## Proximos passos sugeridos

1. Corrigir primeiro os IDs duplicados dos containers de tipos e tecnicos.
2. Refatorar `openServiceFromClient()` para passar dados iniciais a `openNewSvc()` sem sobrescrever funcao global.
3. Validar o fluxo de Roteiro do Dia e decidir se a remocao de `rot-modal` deve permanecer.
4. Decidir oficialmente o destino de `frontend/js/app.js` e `frontend/js/api.js`: remover como legado ou migrar o HTML para usa-los.
5. Depois das correcoes, repetir as tres checagens estaticas desta auditoria.
