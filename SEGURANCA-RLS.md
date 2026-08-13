# Seguranca do Supabase e RLS

## O que o alerta significa

`rls_disabled_in_public` significa que uma tabela exposta pela Data API esta sem Row-Level Security. Com a publishable/anon key, que por design pode aparecer no navegador, terceiros podem chamar a API do Supabase diretamente. No LetecLog, a auditoria de 12/08/2026 confirmou leitura anonima nas 26 tabelas de aplicacao testadas, inclusive clientes, servicos, usuarios, sessoes e logs.

A publishable key nao e um segredo. A protecao deve vir de RLS, privilegios SQL e autenticacao/autorizacao no backend. A `service_role`, ao contrario, e secreta e nunca pode ir para o frontend.

## Arquitetura adotada

```text
Navegador autenticado -> API Node/Express -> Supabase service_role -> tabelas

Navegador com anon key -> Supabase Auth apenas
Navegador com anon key -> tabelas public: negado
```

- As tabelas `public` usam RLS sem policies para `anon` ou `authenticated` (default deny).
- Os privilegios DML desses dois papeis tambem sao revogados.
- Um event trigger habilita RLS e revoga DML automaticamente em novas tabelas `public`.
- O backend exige `SUPABASE_SERVICE_ROLE_KEY`; nao existe fallback para a anon key.
- A API exige sessao de admin/operador por padrao (`API_AUTH_REQUIRED=true`).
- O portal tecnico usa sessao propria, acessa somente rotas permitidas e recebe dados filtrados.
- Lembretes e atualizacao da agenda passam pelo backend; o Realtime direto foi substituido por polling autenticado.

## Implantacao segura

1. Troque imediatamente a senha da conta que usou o antigo `bootstrap-internal-admin.sql` e revogue todas as sessoes dela. A senha apareceu no repositorio e deve ser considerada comprometida.
2. Confirme no Render que `SUPABASE_SERVICE_ROLE_KEY` esta configurada e que `API_AUTH_REQUIRED=true`.
3. Publique backend e frontend desta versao.
4. Em staging, valide login, agenda, clientes, portal tecnico, checklists, estoque, frota e lembretes.
5. Execute `migration-security-enable-rls.sql` no SQL Editor do Supabase. Ela e transacional e deve ser a ultima migration.
6. Confira o resultado da consulta final: `rls_enabled` deve ser `true`; `anon_has_dml` e `authenticated_has_dml` devem ser `false` em todas as tabelas listadas.
7. Rode novamente o Security Advisor. O alerta `rls_disabled_in_public` deve desaparecer.
8. Teste em aba anonima: a URL do Supabase mais a publishable key nao deve devolver registros. O aplicativo deve continuar funcionando depois do login.

Se a API parar logo apos a migration, nao desabilite RLS. Corrija `SUPABASE_SERVICE_ROLE_KEY` no backend e reinicie o servico. Desabilitar RLS recriaria a exposicao.

Se uma versao anterior da migration retornar `relation "AS" does not exist`, nao continue usando a copia antiga. A versao atual remove primeiro o gatilho anterior e resolve os nomes das tabelas por `pg_class`/`pg_namespace`, sem interpretar `object_identity` como SQL. Execute novamente o arquivo completo; como o bloco usa `BEGIN`/`COMMIT`, uma falha anterior ao `COMMIT` e revertida pelo PostgreSQL.

## Checklist para cada tabela nova

- Justificar por que a tabela precisa existir e quais dados antigos ela afeta.
- Criar a tabela por migration versionada.
- Habilitar RLS na mesma migration.
- Decidir explicitamente se o acesso sera somente pelo backend (padrao do LetecLog).
- Nunca criar policy com `USING (true)` ou `WITH CHECK (true)` sem uma justificativa revisada.
- Nunca colocar `service_role`, senhas, tokens da Evolution ou chaves privadas em HTML, JavaScript do navegador, logs ou prompts.
- Testar acesso autorizado e negado; nao validar apenas o caminho feliz.
- Rodar o Security Advisor depois da implantacao.

## Vibe coding com seguranca

Codigo gerado por IA deve ser tratado como codigo de um colaborador novo: util, mas sujeito a revisao. Para mudancas de autenticacao, banco, upload, WhatsApp ou dados pessoais, exija sempre modelo de ameacas simples, menor privilegio, validacao no servidor, testes de negacao e revisao de segredos. CORS, esconder botoes e ocultar a anon key nao sao controles de autorizacao.
