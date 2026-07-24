# Fase 3 — Homologação e implantação do fluxo oficial

## Objetivo

Colocar o fluxo oficial de serviços em uso com segurança, validando banco, backend,
Agenda, Hoje e Portal Técnico antes da liberação em produção. Esta fase não fará
normalização em massa dos registros antigos.

## Etapa 1 — Preparar a homologação

- Confirmar backup recente do banco e registrar a quantidade de serviços por
  `status` e `exec_status` antes da mudança.
- Confirmar que o ambiente de homologação usa a mesma versão de schema da produção.
- Aplicar `migration-service-transitions-phase2.sql` somente na homologação.
- Verificar a criação das quatro colunas, do índice único e da função transacional.
- Confirmar que nenhum registro existente foi atualizado pela migration.

### Critério de saída

Schema criado sem perda de dados e contagens anteriores preservadas.

## Etapa 2 — Testar a máquina de estados

Criar serviços exclusivos de teste e validar:

1. Fluxo técnico completo: agendado, deslocamento, chegada, execução e finalização.
2. Conclusão manual antes do início, sempre com motivo.
3. Conclusão manual durante uma execução, incluindo o alerta reforçado.
4. Registro de problema pelo técnico sem transformar o serviço em executado.
5. Resolução do problema por conclusão com ressalva.
6. Resolução do problema por cancelamento.
7. Resolução do problema por reagendamento.
8. Repetição da mesma requisição de reagendamento sem criar visita duplicada.
9. Tentativa offline atrasada sem reabrir ou regredir uma visita terminal.
10. Bloqueio de transições sensíveis feitas pelo endpoint genérico de edição.

### Evidências esperadas

- Estado final correto em `services`.
- Motivo, origem e momento registrados.
- Evento técnico preservado e problema administrativo resolvido.
- Registro correspondente em `activity_logs`, com autor, ação e rota.
- Nova visita ligada ao original por `rescheduled_from_id` quando aplicável.

## Etapa 3 — Validar as telas operacionais

- Agenda em Lista: busca, filtros, contagens e ações administrativas.
- Agenda em Calendário: navegação mensal, abertura e edição de serviço.
- Confirmar que o quadro por Status não existe mais nem pode ser aberto por código
  ou estado antigo do navegador.
- Hoje: problema visível até decisão e removido após conclusão, reagendamento ou
  cancelamento.
- Hoje: serviços legados concluídos não aparecem como ativos, atrasados ou conflito.
- Portal Técnico: visitas terminais não aceitam novas ações e a finalização normal
  registra origem `portal_tecnico`.
- Validar desktop administrativo e celular do técnico.

### Critério de saída

Nenhum bloqueio operacional e nenhuma divergência entre Lista, Calendário, Hoje e
Portal Técnico.

## Etapa 4 — Ensaio com operadores

- Selecionar um operador administrativo e um técnico para o teste assistido.
- Executar um atendimento normal e cada exceção administrativa.
- Registrar dúvidas de texto, sequência ou botões sem alterar a regra de domínio.
- Corrigir somente problemas confirmados e repetir o cenário afetado.

## Etapa 5 — Liberação em produção

- Definir uma janela de baixo movimento.
- Confirmar novamente o backup e as contagens de referência.
- Aplicar a migration antes de publicar o backend e o frontend.
- Publicar os commits da Fase 2 e a remoção definitiva do quadro de Status.
- Fazer smoke test com serviços controlados.
- Monitorar erros da API, `activity_logs`, problemas pendentes e reagendamentos nas
  primeiras horas.

## Plano de reversão

- Em falha de interface, voltar backend/frontend para o commit anterior.
- As colunas aditivas permanecem no banco durante a reversão; não removê-las no
  incidente, pois são compatíveis e podem conter histórico novo.
- Se a função de reagendamento apresentar falha, suspender essa ação na interface e
  manter Lista e Calendário em consulta até a correção.
- Nunca apagar a nova visita ou o original automaticamente durante rollback.

## Aceitação final

- Todos os cenários da Etapa 2 aprovados.
- Lista, Calendário, Hoje e Portal Técnico coerentes.
- Nenhum serviço antigo alterado automaticamente.
- Nenhum reagendamento duplicado.
- Toda transição sensível auditável.
- Suíte automatizada e auditoria do frontend aprovadas na versão publicada.

## Fora do escopo

- Push de notificação para deslocamento.
- Novos quadros por status no Hoje ou na Agenda.
- Normalização em massa dos registros legados.
- Mudança das regras de contratos, recorrência ou comunicação com clientes.
