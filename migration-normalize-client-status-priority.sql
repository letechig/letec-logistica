-- Normalizacao segura de status/prioridade de clientes.
-- Rode manualmente no Supabase SQL Editor.
-- Nao apaga registros nem altera historico de servicos.

begin;

update customers
set prioridade = 'Média'
where prioridade in ('Media', 'media', 'MEDIA', 'MÉDIA', 'média');

update customers
set status_operacional = 'Eventual'
where status_operacional in (
  'Eventual recente',
  'Eventual antigo',
  'eventual recente',
  'eventual antigo'
);

update customers
set status_operacional = 'Inativo',
    ativo = false
where status_operacional in (
  'Historico/Inativo',
  'Histórico/Inativo',
  'historico/inativo',
  'histórico/inativo',
  'Cancelado',
  'cancelado',
  'Inativo',
  'inativo'
);

commit;

