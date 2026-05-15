# Checklist de Confiabilidade Letec

Use este roteiro depois de deploys ou quando um computador parecer carregar dados de forma diferente.

## Smoke da API

```bash
npm run smoke:operacional
```

Para testar outro backend:

```bash
$env:LETEC_API_BASE_URL="http://localhost:8000"; npm run smoke:operacional
```

O smoke deve encerrar com `Todos os endpoints criticos responderam`. A Evolution pode aparecer como aviso quando estiver desconectada ou sem configuração, desde que o backend responda com diagnóstico claro.

## Navegador Limpo

1. Abra o sistema em uma janela anônima ou navegador sem cache.
2. Confirme que o indicador no topo mostra `Online`.
3. Clique no indicador e abra o Diagnóstico Operacional.
4. Confira se a API em uso é `https://letec-api.onrender.com` em produção.
5. Confira se o checklist de suporte não mostra ação necessária.

## Agenda e Clientes

1. Crie um serviço usando cliente existente pelo autocomplete.
2. Confirme que o serviço salva com cliente vinculado.
3. Crie um serviço com cliente novo diretamente pela Agenda.
4. Confirme que o cliente aparece em Clientes depois de salvar.
5. Edite equipe, veículo, horário e status de um serviço existente.
6. Confirme que a alteração permanece após atualizar a página.

## Offline e Sincronização

1. Com a Agenda aberta, coloque o navegador offline.
2. Crie ou edite um serviço.
3. Abra o Diagnóstico Operacional e confirme item na fila offline.
4. Volte online e clique em `Sincronizar agora`.
5. Confirme que a fila esvazia ou mostra erro permanente claro.

## Portal Técnico

1. Abra `/portal-tecnico.html` com parâmetros reais de técnico/data.
2. Confirme que serviços, checklists e recados carregam ou usam cache com aviso claro.
3. Registre chegada, início e finalização de um atendimento de teste.
4. Salve um checklist diário.
5. Teste offline, registre uma ação e volte online para sincronizar.
6. Use `Copiar diagnostico` se algo falhar.

## Em Caso de Erro

1. Copie o Diagnóstico Operacional pelo sistema principal.
2. Copie o diagnóstico do Portal Técnico, quando o problema for no portal.
3. Rode `npm run smoke:operacional`.
4. Envie os três resultados junto com a tela, data e computador usado.
