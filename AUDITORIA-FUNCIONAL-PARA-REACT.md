# Auditoria Funcional Para Limpeza e Migracao React

Data: 2026-06-22

Objetivo: mapear o sistema atual por uso operacional, identificar duplicidades, informacoes sobrando/faltando e definir uma ordem segura para limpar antes de migrar para React.

Fontes revisadas:

- `frontend/index.html`
- `frontend/portal-tecnico.html`
- `frontend/radar-gestor.html`
- `server.js`
- `AUDITORIA-FRONTEND-INDEX.md`
- `AUDITORIA-ESTRUTURA-ATUAL.md`

Validacao de apoio executada:

- `npm run audit:frontend`: OK

Observacao importante: existem mudancas locais recentes e ainda nao finalizadas/confirmadas sobre login tecnico, auditoria de atividades e novas migrations. Antes de iniciar React, decidir se essas mudancas entram oficialmente ou se devem ser separadas/revertidas.

## Visao Geral

O sistema atual resolve muita coisa operacional, mas concentra fluxos demais em uma unica aplicacao HTML. A navegacao principal mistura operacao diaria, gestao, cadastros, saneamento de dados, frota, estoque e comunicacao. Isso deixa o sistema poderoso, mas aumenta ruido para quem precisa apenas tomar uma decisao rapida.

A migracao para React nao deve copiar a estrutura atual tela por tela. O melhor caminho e usar esta auditoria para separar responsabilidades:

- Operacao: agenda, hoje, roteiro, comunicacao e central de campo.
- Clientes: cadastro, unidades, contratos, historico e saneamento.
- Campo: portal tecnico, execucao, checklist, recados e evidencias.
- Frota: veiculos, documentos, manutencoes, alertas e KM.
- Estoque: produtos, movimentos e alertas.
- Gestao: dashboard, radar, indicadores e servicos por funcionario.
- Configuracoes: tecnicos, veiculos, tipos de servico, parametros operacionais e acessos.

## Mapa Atual por Area

| Area | Telas/fluxos atuais | Usuarios | Trabalho que ajuda a fazer | Decisao recomendada |
|---|---|---|---|---|
| Hoje / Central do Dia | `page-hoje`, painel de servicos do dia, `field-ops-panel` | Operador, gestor | Acompanhar execucao, pendencias e alertas do campo | **Manter e promover** como tela principal da operacao |
| Agenda | `page-agenda`, lista, status/kanban e calendario | Operador, admin | Criar, editar, reagendar, filtrar e consultar servicos | **Manter**, mas simplificar views e padronizar status |
| Roteiro | `page-roteiro`, montagem por tecnico, WhatsApp, links do portal | Operador | Montar sequencia e enviar agenda para campo | **Manter**, mas juntar comunicacao repetida com WhatsApp |
| WhatsApp / Comunicacao | `page-comunicacao`, mensagens, Evolution, lembretes 24h | Operador | Ver status de envio, enviar agenda/lembrete e reenviar erros | **Juntar** com roteiro e lembretes por cliente em uma central de comunicacao |
| Portal Tecnico | `portal-tecnico.html`, Hoje, Semana, Checklist, Ajuda, Recados, Historico | Tecnico | Executar servico, registrar chegada/inicio/fim, checklist e ajuda | **Manter e priorizar** para React MVP separado |
| Clientes | `page-clientes`, modal cliente, duplicatas, auditoria de vinculos | Admin, operador | Consultar base, atualizar dados, criar servico, resolver duplicatas | **Manter**, mas separar cadastro operacional de saneamento |
| Revisao de Dados | `page-revisao`, pendencias de importacao | Admin | Saneamento da base e dados incompletos | **Mover** para Clientes > Qualidade de Dados |
| Contratos / Historico Cliente | Modal de cliente e endpoints de contratos/historico | Admin, operador | Entender recorrencia, vencimento e historico | **Criar destaque**; dados existem, mas nao parecem centrais na navegacao |
| Checklist | `page-checklist` no admin e checklist no portal | Tecnico, operador | Registrar saida, retorno, KM, veiculo e equipamentos | **Juntar conceito**; admin deve ser consulta/correcao, tecnico deve ser origem principal |
| Rotas & KM | `page-rotas`, KM mensal, eficiencia, Google Maps | Gestor, operador | Analisar deslocamento e custo operacional | **Manter**, mas mover para Frota/Gestao conforme uso |
| Frota | `page-frota`, veiculos, documentos, manutencoes, alertas | Admin, gestor | Controlar veiculos, vencimentos e manutencao | **Manter**, reduzir duplicidade com Config > Veiculos |
| Estoque | `page-estoque`, produtos e movimentos | Admin, operador | Controlar materiais e movimentacoes | **Manter**, mas precisa de alertas e relacao com servico/campo |
| Dashboard / Gestao | `page-dashboard`, KPIs, alertas, capacidade, top clientes | Gestor | Tomar decisoes mensais/operacionais | **Manter**, mas separar decisao diaria de analise mensal |
| Radar Gestor | `radar-gestor.html`, capacidade, encaixe, semana, alertas | Gestor | Decidir se cabe mais servico e onde encaixar | **Juntar ou integrar** com Gestao; hoje esta isolado |
| Indicadores | `page-equipes` | Gestor | Ver distribuicao/equipe | **Juntar** com Gestao |
| Servicos por Funcionario | `page-servicos-funcionario` | Gestor, admin | Ver producao por tecnico | **Manter**, mas como relatorio dentro de Gestao |
| Historico Completo | `page-historico`, checklists/registros | Admin, gestor | Auditar registros antigos | **Renomear/mover** para Auditoria/Registros |
| Configuracoes | tecnicos, veiculos, tipos, operacional | Admin | Manter cadastros base e parametros | **Manter**, mas deixar apenas configuracao, nao operacao |

## Duplicidades e Excesso de Informacao

### Duplicidades principais

- **Hoje x Agenda x Roteiro**: as tres telas mostram servicos do dia com perspectivas proximas. O React deve separar claramente:
  - Hoje: acompanhamento e excecoes.
  - Agenda: cadastro e planejamento.
  - Roteiro: sequencia e envio ao campo.
- **Roteiro x WhatsApp**: envio de agenda para tecnico aparece no roteiro e na comunicacao. Deve virar um unico fluxo: preparar roteiro, revisar, enviar e acompanhar status.
- **Checklist admin x Checklist portal**: o mesmo conceito aparece em dois lugares. O portal deve criar o registro; o admin deve consultar, corrigir e auditar.
- **Frota x Configuracao de veiculos**: cadastro simples de veiculos em Config e gestao completa em Frota. O cadastro deve ser uma acao da propria Frota ou uma aba de Config que redireciona para Frota.
- **Dashboard x Radar Gestor x Indicadores x Servicos por Funcionario**: todos sao visoes de gestao. Devem virar uma area "Gestao" com subvisoes, nao quatro entradas competindo.
- **Clientes x Revisao de Dados x Duplicatas x Auditoria de Vinculos**: sao todas funcoes de qualidade da base. Devem ficar agrupadas em Clientes > Qualidade.

### Informacoes que parecem ruido na tela principal

- Muitos KPIs e graficos no Dashboard aparecem juntos sem uma hierarquia clara de decisao.
- Filtros extensos em Clientes e Agenda ocupam muito espaco e deveriam ser colapsaveis por padrao.
- Botoes de acao em massa de Clientes incluem caminhos ainda bloqueados ou pouco claros; devem ficar ocultos ate estarem completos.
- "Novidades", versao, diagnostico, status do sistema e exportacao competem com a acao principal no topo.
- No Portal Tecnico, "Mais", "Historico", "Recados" e diagnostico podem continuar, mas devem ficar secundarios; o tecnico precisa ver primeiro a proxima acao.

## Informacoes Faltantes

### Operacao e Agenda

- Responsavel real por cada alteracao e status de auditoria visivel para operador.
- Motivo padronizado para reagendamento, cancelamento e problema.
- Indicador claro de servico em risco: atraso, sobreposicao, cliente sem confirmacao, tecnico sem agenda confirmada.
- Linha do tempo do servico: criado, enviado ao tecnico, confirmado, deslocamento, chegada, inicio, fim, evidencia.
- Diferenca clara entre status administrativo (`agendado`, `cancelado`, `executado`) e status de execucao em campo (`em_deslocamento`, `cheguei`, `em_execucao`, `finalizado`, `problema`).

### Portal Tecnico

- Evidencias estruturadas: foto, assinatura/dispensa, GPS obrigatorio por etapa critica quando aplicavel.
- Mensagem de bloqueio clara quando tecnico tenta acessar servico que nao e dele.
- Estado de sincronizacao por item, nao apenas fila geral.
- Orientacao para pendencia: o que falta para finalizar um servico.

### Clientes

- Aba consolidada por cliente: dados, unidades, contratos, historico, pendencias e proximos servicos.
- Indicador de qualidade do cadastro: telefone ausente, endereco incompleto, duplicidade provavel, contrato vencendo.
- Historico operacional resumido e acionavel, nao apenas lista.
- Distincao entre cliente ativo, contrato ativo, eventual e inativo.

### WhatsApp

- Status final por mensagem com acao recomendada: enviado, erro, reenviar, copiar manual.
- Historico por cliente/tecnico dentro do contexto do servico.
- Template e pre-visualizacao centralizados.

### Frota e Estoque

- Relacao entre veiculo, tecnico, checklist e servicos do dia.
- Alertas de estoque minimo e produtos consumidos por servico/equipe.
- Movimentacao de estoque ligada a atendimento ou checklist, quando existir consumo real.

### Gestao

- Visao executiva unica: "o que precisa de decisao hoje?"
- Separar analise diaria de analise mensal.
- Indicadores com dono e acao: capacidade, atraso, produtividade, risco, renovacao, frota, estoque.

## Decisoes Recomendadas

### Manter

- Hoje como central operacional do dia.
- Agenda com cadastro/edicao e visoes por calendario/status.
- Portal Tecnico como produto separado e prioritario.
- Clientes como modulo forte, mas reorganizado.
- Frota e Estoque como modulos proprios.
- Comunicacao WhatsApp, desde que integrada ao roteiro e clientes.

### Juntar

- Roteiro + envio de agenda ao tecnico + status de mensagens.
- Dashboard + Radar Gestor + Indicadores + Servicos por Funcionario em uma area "Gestao".
- Revisao de Dados + Duplicatas + Auditoria de Vinculos dentro de Clientes > Qualidade.
- Checklist admin + Historico de checklist dentro de Campo/Frota, deixando o portal como entrada principal.

### Remover ou esconder inicialmente

- Acoes em massa de Clientes que nao estao completas ou nao tem fluxo seguro.
- Filtros raros abertos por padrao.
- Cards de KPI que nao geram decisao imediata.
- Duplicidade de cadastro de veiculos fora do modulo Frota.
- Atalhos que apenas repetem outra tela sem contexto.

### Renomear

- "Dashboard / Gestao" para "Gestao".
- "Indicadores" para "Relatorios" ou subaba dentro de Gestao.
- "Historico Completo" para "Registros e Auditoria".
- "WhatsApp e Confirmacoes" para "Comunicacao".
- "Cadastros e Configuracoes" para "Configuracoes".

### Mover

- Revisao de Dados para Clientes > Qualidade.
- Servicos por Funcionario para Gestao > Produtividade.
- Rotas & KM para Frota ou Gestao > Deslocamento.
- Configuracao de veiculos para Frota > Cadastro ou Configuracoes > Cadastros Base.

### Criar

- Linha do tempo do servico.
- Painel "Pendencias de hoje" por gravidade.
- Visao 360 do cliente.
- Auditoria de atividade visivel por registro.
- Templates de mensagem centralizados.
- Estados padronizados e dicionario de status.

## Proposta de Navegacao React

### Operacao

- Hoje
- Agenda
- Roteiro
- Comunicacao
- Pendencias

### Clientes

- Base de clientes
- Cliente 360
- Unidades e contratos
- Qualidade de dados
- Historico operacional

### Campo

- Portal do Tecnico
- Central de Campo
- Recados
- Evidencias
- Checklists

### Frota

- Veiculos
- Documentos
- Manutencoes
- KM e deslocamento
- Alertas

### Estoque

- Produtos
- Movimentacoes
- Alertas
- Consumo por equipe/servico

### Gestao

- Radar do dia
- Capacidade
- Produtividade
- Relatorios
- Tendencias

### Configuracoes

- Tecnicos e acessos
- Tipos de servico
- Parametros operacionais
- Integrações
- Auditoria e sistema

## Prioridade Para React

### Antes do React

1. Decidir e finalizar as mudancas pendentes de login tecnico/auditoria.
2. Aplicar migrations pendentes no Supabase ou separar do escopo.
3. Padronizar status de servico e execucao em um dicionario unico.
4. Definir quais dados sao obrigatorios para servico, cliente e finalizacao.
5. Congelar o mapa de navegacao futura.

### React MVP

1. Portal Tecnico React.
2. Operacao > Hoje.
3. Agenda basica: lista/calendario, criar e editar servico.
4. Comunicacao minima: enviar agenda e acompanhar erro/sucesso.
5. Cliente 360 basico: dados, unidades, historico e proximos servicos.

### Depois do React MVP

1. Frota completa.
2. Estoque completo.
3. Gestao/Radar integrado.
4. Qualidade de dados e duplicatas.
5. Auditoria visual por entidade.
6. Relatorios e produtividade.

## Backlog Inicial

### Urgente operacional

- Finalizar login tecnico e restricao de acesso.
- Exibir autoria/auditoria das alteracoes operacionais.
- Centralizar pendencias do dia.
- Padronizar status e motivos de cancelamento/reagendamento/problema.
- Reduzir duplicidade entre Hoje, Agenda e Roteiro.

### Importante para gestao

- Integrar Radar Gestor ao Dashboard/Gestao.
- Criar indicadores com acao recomendada, nao apenas numeros.
- Melhorar produtividade por tecnico/equipe.
- Mostrar capacidade diaria e risco de encaixe no fluxo de agenda.

### Limpeza antes do React

- Remover/ocultar acoes incompletas.
- Agrupar revisao/duplicatas/auditoria de vinculo em Clientes.
- Unificar comunicacao do roteiro e tela WhatsApp.
- Reduzir filtros visiveis por padrao.
- Documentar modelos de dados essenciais para React.

### Melhorias futuras

- Evidencias com foto/assinatura/GPS no portal.
- Consumo de estoque por servico.
- Templates configuraveis de WhatsApp.
- Auditoria visual por servico/cliente/tecnico.
- Permissoes por papel: admin, operador, tecnico, gestor.

## Validacao Manual Recomendada

Executar estes fluxos e marcar onde ha excesso ou falta de informacao:

1. Criar servico novo pela Agenda.
2. Editar servico e alterar status/equipe/cliente.
3. Montar roteiro e enviar agenda ao tecnico.
4. Tecnico executar chegada/inicio/finalizacao no portal.
5. Operador acompanhar pendencias no Hoje/Central de Campo.
6. Buscar cliente, abrir cadastro, ver unidades/contratos/historico.
7. Enviar lembrete/confirmacao por WhatsApp.
8. Consultar frota, documento vencido e manutencao.
9. Consultar estoque e registrar movimento.
10. Gestor abrir Radar/Dashboard para decidir encaixe.

## Regras Para Decidir Se Fica ou Sai

- Fica se ajuda uma decisao operacional, gestao, rastreabilidade ou execucao no campo.
- Junta se resolve o mesmo problema que outra tela.
- Sai/esconde se e ruido, acao incompleta ou dado sem decisao associada.
- Move se pertence a outro contexto mental do usuario.
- Cria se evita erro operacional, retrabalho ou falta de auditoria.

## Conclusao

O sistema tem cobertura funcional ampla, mas precisa de reorganizacao antes de React. A prioridade nao deve ser "converter HTML para componentes", e sim redesenhar a experiencia em torno dos trabalhos reais: operar o dia, executar campo, cuidar da base de clientes, controlar recursos e tomar decisao de gestao.

A primeira entrega React recomendada e o Portal Tecnico, seguido pela Operacao do Dia. Essas partes tem escopo mais claro, maior impacto operacional e ajudam a validar a nova arquitetura sem reescrever todo o painel de uma vez.
