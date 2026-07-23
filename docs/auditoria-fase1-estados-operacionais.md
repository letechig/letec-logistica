# Auditoria da Fase 1 — Estados operacionais

Data do levantamento: 22/07/2026  
Escopo: tabela `services`, eventos do portal técnico e fluxos de atualização no frontend/backend.  
Modo: somente leitura. Nenhum registro ou schema foi alterado.

## Objetivo

Mapear como `status` e `exec_status` são usados de fato antes de alterar os alertas do painel Hoje.

- `status` representa o estado administrativo do serviço: agendado, executado, reagendado ou cancelado.
- `exec_status` representa o andamento em campo: agendado, em deslocamento, chegou, em execução, finalizado ou problema.

## Fotografia dos dados

Foram encontrados 957 serviços.

### Status administrativo

| Status | Quantidade |
|---|---:|
| Executado | 897 |
| Agendado | 48 |
| Reagendado | 9 |
| Cancelado | 3 |

### Estado de execução em campo

| Estado | Quantidade |
|---|---:|
| Agendado | 772 |
| Finalizado | 154 |
| Em deslocamento | 14 |
| Problema | 8 |
| Chegou | 7 |
| Em execução | 2 |

### Combinações principais

| `status` | `exec_status` | Quantidade | Interpretação inicial |
|---|---|---:|---|
| Executado | Agendado | 715 | Predominantemente legado/manual; não equivale a execução digital completa |
| Executado | Finalizado | 154 | Fluxo digital completo esperado |
| Agendado | Agendado | 46 | Ainda não iniciado |
| Executado | Em deslocamento | 13 | Estado contraditório e incompleto |
| Reagendado | Agendado | 9 | Compatível com legado, mas exige verificar nova data |
| Executado | Chegou | 7 | Estado contraditório e incompleto |
| Executado | Problema | 7 | Problema encerrado administrativamente sem regra explícita |
| Cancelado | Agendado | 2 | Cancelamento administrativo sem espelhamento no campo |
| Cancelado | Problema | 1 | Exceção que precisa de regra oficial |
| Executado | Em execução | 1 | Estado contraditório e incompleto |
| Agendado | Em deslocamento | 1 | Fluxo ativo esperado |
| Agendado | Em execução | 1 | Fluxo ativo esperado |

## Inconsistências objetivas encontradas

| Situação | Quantidade | Severidade inicial |
|---|---:|---|
| Estado administrativo terminal com execução ainda ativa | 21 | Alta |
| Serviços sem data | 9 | Alta para Agenda/Hoje |
| Horário ausente ou fora de `HH:MM` | 8 | Média |
| Sem equipe textual e sem `tecnicos_ids` | 4 | Alta quando o serviço estiver ativo |
| Fim registrado sem início | 2 | Média |
| Agendados em data anterior a 22/07/2026 | 14 | Alta; requer revisão individual |
| Problema sem descrição | 0 | Regra atual funcionando |
| Ordem chegada/início/fim inválida | 0 | Regra atual funcionando |
| `date` e `data` preenchidos com valores divergentes | 0 | Sem ocorrência |
| Finalizado sem `fim_hora` | 0 | Regra atual funcionando |

Há 736 serviços administrativamente executados sem `fim_hora`. Esse número não deve ser tratado como 736 erros: a maioria pertence ao histórico marcado manualmente, antes ou fora do fluxo completo do portal. Esses registros precisam ser classificados como **histórico administrativo sem telemetria de campo**, não como finalizações digitais defeituosas.

## Recorte recente

Nos 30 dias entre 22/06/2026 e 22/07/2026 foram encontrados 125 serviços:

- 33 em `executado | finalizado`;
- 68 em `executado | agendado`;
- 6 administrativamente encerrados com execução ainda em deslocamento, chegada ou execução;
- 36 com pelo menos um horário real de campo;
- 74 executados sem horário de fim.

Portanto, o uso do portal técnico já existe, mas ainda convive com a conclusão manual pela administração.

## Eventos do portal técnico

Foram encontrados 877 eventos:

| Evento | Registros | Serviços distintos |
|---|---:|---:|
| Finalização | 240 | 169 |
| Chegada | 229 | 173 |
| Início | 212 | 165 |
| Deslocamento | 141 | 135 |
| Ajuda | 42 | — |
| Problema | 8 | 8 |

Pontos de atenção:

- Há mais eventos que serviços distintos, indicando repetições em parte do histórico.
- Existem 12 serviços referenciados por eventos de finalização que já não existem na tabela `services`.
- Existem eventos de finalização cujo serviço atual voltou a `exec_status = agendado` ou permaneceu em `cheguei`.
- 279 eventos estão com status pendente; nem todos representam necessariamente uma ação atual do operador.

O histórico de eventos deve ser usado como evidência, mas não pode sozinho definir o estado atual sem uma política de deduplicação e encerramento.

## Como os estados são atualizados hoje

### Portal técnico

O portal segue uma sequência coerente:

1. `agendado` → `em_deslocamento`;
2. `em_deslocamento` → `cheguei`, registrando chegada e GPS quando disponível;
3. `cheguei` → `em_execucao`, registrando início e espera;
4. `em_execucao` → `finalizado`, registrando fim, duração e alterando `status` para `executado`;
5. `em_execucao` → `problema`, registrando fim e descrição, sem uma transição administrativa oficial equivalente.

O backend impede regressão simples do `exec_status` e bloqueia dois atendimentos ativos para a mesma equipe/técnico no mesmo dia.

### Painel administrativo

As ações rápidas e a ação em lote alteram apenas `status`/`st`. Elas não encerram nem normalizam `exec_status` e não registram horários de campo.

Essa separação explica a maioria dos registros `executado | agendado` e também permite encerrar administrativamente um serviço que ainda aparece em deslocamento, chegada ou execução.

### Consequência operacional

O painel Hoje não pode interpretar todo `executado | agendado` como erro. Ele precisa distinguir:

- histórico administrativo/manual;
- execução digital completa;
- execução digital interrompida;
- estado realmente contraditório;
- serviço atual que exige intervenção.

## Riscos prioritários

### P0 — Duas fontes podem encerrar o mesmo serviço de maneiras diferentes

O portal finaliza `exec_status` e `status` em conjunto. O painel administrativo altera apenas `status`. Isso produz interpretações diferentes do mesmo atendimento.

### P0 — Estado terminal com execução ativa

Os 21 casos em `executado/cancelado/reagendado` com `exec_status` em deslocamento, chegada ou execução são contradições reais. Em um serviço do dia, esse estado pode gerar alerta incorreto e interferir na validação de outro atendimento ativo da equipe.

### P1 — Legado sem telemetria não está explicitamente identificado

Os 715 casos `executado | agendado` misturam histórico válido com possíveis encerramentos manuais recentes. Não é seguro corrigi-los em lote nem exigir horários retroativos.

### P1 — Data ausente quebra Agenda, Calendário e Hoje

Os nove serviços sem data aparecem com `/` na Lista e não podem ser corretamente classificados por dia.

### P1 — Eventos pendentes geram ruído

Existem 279 eventos pendentes. A prioridade do Hoje deve considerar tipo, idade, serviço atual e resolução, não apenas `status = pendente`.

### P2 — Eventos repetidos e órfãos

Eventos duplicados ou ligados a serviços removidos reduzem a confiabilidade do histórico e das contagens.

## Regras propostas para decisão na Fase 2

Estas regras ainda não foram implementadas:

1. `status` continua sendo administrativo; `exec_status` continua sendo execução de campo.
2. Um serviço `executado | agendado` sem eventos/horários de campo é classificado como `concluído manualmente`, não como erro.
3. Um serviço terminal com `exec_status` ativo é classificado como `execução interrompida/inconsistente`.
4. A finalização normal do portal deve manter `status = executado` e `exec_status = finalizado` atomicamente.
5. “Marcar executado” pela administração precisa de uma decisão de produto:
   - conclusão administrativa sem dados de campo; ou
   - encerramento excepcional com confirmação e motivo.
6. `problema` precisa de uma regra administrativa explícita: permanece agendado, vira não executado ou exige resolução do operador.
7. Reagendamento só é resolvido quando existir nova data/novo serviço relacionado, não apenas pela troca do texto de status.
8. Alertas do Hoje devem considerar apenas o dia selecionado e estados acionáveis; legado não deve poluir as prioridades.
9. Serviços sem data, equipe ou horário precisam de uma fila de qualidade de dados, separada de atraso em campo.

## Próximo passo recomendado

Executar a Fase 2 como uma decisão de domínio antes de editar código:

1. aprovar a tabela oficial de transições;
2. definir o significado de conclusão manual;
3. definir o destino administrativo de `problema`;
4. definir quando reagendamento está resolvido;
5. definir quais transições exigem confirmação ou justificativa;
6. somente depois alterar os classificadores do Hoje.

## Garantia de não mutação

As consultas desta auditoria usaram apenas operações `select`. Não foram executados `insert`, `update`, `delete`, migration ou alteração de schema.
