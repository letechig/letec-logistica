# Checklist de Publicacao

Use este checklist antes de qualquer deploy no sistema.

## 1. Confirmar o alvo da mudanca

- Frontend principal em producao: `frontend/index.html`
- Backend/API: `server.js`
- Vercel deve apontar para `frontend`
- Render publica a raiz do repositorio

## 2. Validacao local obrigatoria

- Rode `npm start`
- Abra `http://localhost:8000/`
- Confirme que a pagina abre sem tela em branco
- Confirme que nao aparece erro no console do navegador

## 3. Smoke test minimo

Teste sempre estes pontos antes de publicar:

- Login abre normalmente
- `Dashboard` carrega
- `Agenda` abre e troca de tela
- `Clientes` abre e o modal de cliente funciona
- `Check List` abre e salva sem quebrar a tela
- Navegacao lateral funciona sem erro `nav is not defined`

## 4. Regras para mudancas sensiveis

Nao publique sem validar localmente se a mudanca envolver:

- extracao de JavaScript do HTML
- renomear `id` usado por JavaScript
- mexer em `onclick="..."`
- mover ou renomear arquivos em `frontend/js`
- alterar inicializacao de `window.nav` ou outras funcoes globais
- mudar funcao listada em `GLOBAL-FUNCTIONS-MAP.md`
- mover funcao sem consultar `REFATORACAO-POR-RISCO.md`

## 5. Publicacao

- Rode `git status`
- Confirme que so os arquivos esperados foram alterados
- Rode `git add ...`
- Rode `git commit -m "mensagem clara"`
- Rode `git push origin main`

## 6. Validacao online

Depois do push:

- Verifique se GitHub recebeu o commit certo
- Verifique o deploy novo no Vercel
- Verifique o deploy novo no Render
- Abra o sistema publicado em aba anonima
- Faca `Ctrl + F5`
- Repita o smoke test minimo

## 7. Se algo quebrar

- Nao continue empilhando mudancas
- Descubra qual foi o ultimo commit estavel
- Se a quebra for no frontend inteiro, priorize restaurar `frontend/index.html`
- Se o erro for de deploy, confira branch, root directory e status do deploy

## 8. Regra de ouro

Mudanca estrutural grande nunca entra em um passo so.

Para este sistema, o caminho seguro e:

1. mudar pouco
2. validar localmente
3. publicar
4. validar online
