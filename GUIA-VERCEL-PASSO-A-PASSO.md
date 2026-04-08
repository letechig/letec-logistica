# 📖 Guia Completo: Hospedando seu App no Vercel (PASSO A PASSO)

## Antes de começar...

**Você vai precisar de:**
- Uma conta GitHub (gratuito em github.com)
- Uma conta Vercel (gratuito em vercel.com)
- Cópias de 4 "chaves secretas" do Supabase
- A chave da Google Maps API

---

## PARTE 1: Preparar seu código no GitHub

### Passo 1.1: Criar uma conta GitHub (se não tiver)

1. Vá para **github.com**
2. Clique em "Sign up"
3. Preencha um email, crie uma senha
4. Confirme no seu email
5. Escolha o plano **Free** (gratuito)

### Passo 1.2: Fazer upload do seu código para GitHub

1. Abra seu navegador e acesse **github.com**
2. Faça login com sua conta
3. No canto superior direito, clique no **+** e escolha **"New repository"**
4. Preencha assim:
   - **Repository name**: `letec-logistica` (ou outro nome que quiser)
   - **Description**: Logística e Roteirização (opcional)
   - Escolha **Public** (para o Vercel acessar)
   - Clique **"Create repository"**

5. Você verá uma página com comandos. **Copie todos os comandos** que aparecem em "...or push an existing repository from the command line"

6. Abra o **PowerShell** em `c:\Users\letec\Downloads\logistica`

7. Cole os comandos que você copiou. Se der erro de identidade, rode antes:
```powershell
git config user.name "Seu Nome"
git config user.email "seu-email-do-github@exemplo.com"
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

Se aparecer "remote origin already exists", nao rode `git remote add origin` novamente.

8. Pressione **Enter** e espere terminar. Pronto! Seu código está no GitHub!

---

## PARTE 2: Criar conta Vercel e fazer deploy

### Passo 2.1: Criar conta no Vercel

1. Abra **vercel.com**
2. Clique em **"Sign Up"**
3. Escolha **"Continue with GitHub"**
4. Autorize o Vercel a acessar sua conta GitHub
5. Pronto! Você está no Vercel

### Passo 2.2: Importar seu projeto do GitHub

1. No Vercel, você verá a página inicial. Clique em **"New Project"**
2. Em "Import Git Repository", escolha **seu repositório** `letec-logistica`
3. Quando aparecer a página de configuração, **mude uma coisa importante**:
   - Procure por **"Root Directory"**
   - Mude para **`frontend`**
   - (Essa pasta usa o arquivo oficial auditado que foi ajustado: `letec_v76_auditado.html`, publicado como `frontend/index.html`)

4. Deixe tudo o mais como está e clique **"Deploy"**

5. Espere 2-3 minutos. Quando terminar, você verá "Deployment successful!" 🎉

6. Clique em **"Visit"** e veja seu app ao vivo!

**Sua URL será algo como:** `https://seu-projeto-9abc1234.vercel.app`

---

## PARTE 3: Configurar o Backend no Render

## Qual frontend esta valendo agora?

- O frontend oficial para deploy e o de [frontend/index.html](frontend/index.html).
- Esse arquivo foi gerado a partir da versao auditada [letec_v76_auditado.html](letec_v76_auditado.html), que e onde fizemos os ajustes de roteiro e proxy.
- Arquivos antigos/nao usados foram arquivados em [archive/nao-usados](archive/nao-usados).

### Por que Render?

O Vercel não roda código Node.js bem. O **Render** é gratuito e roda sua API perfeitamente.

### Passo 3.1: Criar conta no Render

1. Vá para **render.com**
2. Clique em **"Get Started"**
3. Clique em **"Sign up with GitHub"**
4. Autorize e confirme seu email

### Passo 3.2: Deploy da API no Render

1. No Render, clique em **"New +"** no canto superior direito
2. Escolha **"Web Service"**
3. Em "Connect a repository", escolha:
   - **seu repositório** `letec-logistica`
   - Clique **"Connect"**

4. Preencha o formulário:
   - **Name**: `letec-api` (ou outro nome)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Root Directory**: deixe em branco (a raiz do repo)

5. Clique em **"Advanced"** e adicione as variáveis de ambiente:
   - Clique em **"Add Environment Variable"** para cada uma:

```
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=seu_service_role_key_bem_longo
SUPABASE_ANON_KEY=seu_anon_key
GOOGLE_MAPS_API_KEY=sua_chave_do_google_maps
ALLOWED_ORIGINS=https://seu-projeto-9abc1234.vercel.app
PORT=8000
```

6. Clique em **"Create Web Service"** e espere o deployment terminar (2-3 minutos)

7. Quando terminar, você verá uma **URL pública** como: `https://letec-api-xxxxx.onrender.com`

**⚠️ IMPORTANTE:** Render coloca serviços free em sleep depois de 15 minutos sem uso. A primeira requisição demora ~30 segundos. Isso é normal e gratuito!

---

## PARTE 4: Conectar o Frontend ao Backend

### Passo 4.1: Dizer ao Frontend onde está a API

1. Acesse seu app no Vercel: `https://seu-projeto-9abc1234.vercel.app`

2. **Abra o console do navegador:**
   - Pressione **F12** (ou Ctrl+Shift+I)
   - Vá na aba **"Console"**

3. Cole este comando (substitua pela URL do Render):
```javascript
window.setLeteApiBaseUrl('https://letec-api-xxxxx.onrender.com');
```

4. Pressione **Enter**

5. Seu app **recarregará automaticamente** e agora vai conectar na API!

6. Você pode verificar se funcionou:
   - Vá em **Aba "Network"** no console (F12)
   - Clique em algum botão do app
   - Você deve ver requisições para **`letec-api-xxxxx.onrender.com`**

---

## PARTE 5: Testar se tudo está funcionando

### Checklist de validação:

- [ ] Login funciona (teste com email/senha)
- [ ] Página de Serviços carrega
- [ ] Criar um novo serviço
- [ ] Roteiro aparece sem erros
- [ ] Tente com 1 serviço (deve mostrar ida+volta)
- [ ] Tente com vários serviços (deve mostrar rota otimizada)
- [ ] Abra o console (F12) e veja se há erros vermelhos

### Se algo não funcionar:

1. **Limpar o navegador:**
   - Pressione **Ctrl+Shift+Delete**
   - Marque "Todos os cookies e dados de site"
   - Clique "Limpar dados"

2. **Verificar se as chaves estão corretas:**
   - Render Dashboard → seu serviço → **"Environment"**
   - Veja se todas as variáveis têm valores

3. **Verificar logs:**
   - Render Dashboard → seu serviço → **"Logs"**
   - Veja se há erros vermelhos

---

## PARTE 6: Atualizar o código no futuro

Sempre que você fizer uma mudança no código:

1. Abra PowerShell em `c:\Users\letec\Downloads\logistica`

2. Execute:
```powershell
git add .
git commit -m "Descrevendo a mudança"
git push
```

3. **Frontend (Vercel)** - atualiza automaticamente em 1-2 minutos

4. **Backend (Render)** - atualiza automaticamente em 2-3 minutos

Não precisa fazer nada! É automático! 🚀

---

## PARTE 7: URLs que você vai usar

Depois que tudo estiver pronto:

- **Seu app:** `https://seu-projeto-9abc1234.vercel.app`
- **Seu backend:** `https://letec-api-xxxxx.onrender.com`
- **GitHub:** `https://github.com/seu-usuario/letec-logistica`
- **Vercel Dashboard:** `https://vercel.com/dashboard`
- **Render Dashboard:** `https://dashboard.render.com`

---

## ❓ FAQ - Dúvidas Comuns

**P: Quanto custa?**
R: Vercel e Render são gratuitos para começar. Supabase tem plano free também. Total: R$ 0 por mês!

**P: E se eu quiser usar meu próprio domínio?**
R: Vercel permite isso facilmente. Vá em Vercel Dashboard → seu projeto → **Domains** → **Add Domain**

**P: O Render fica muito lento?**
R: Sim, se estiver sem uso por 15 minutos, "acorda" lentamente. Para produção real, você pode fazer upgrade para plano pago.

**P: Preciso parar o backend quando não estou usando?**
R: Não! Pode deixar ligado. Render cobra apenas pelos recursos que usa.

**P: Oops, esqueci minha chave do Supabase!**
R: Acesse **supabase.com** → seu projeto → **Settings** → **API**. Copie novamente.

**P: Meu app está no ar mas não funciona nada!**
R: Abra F12 (console), veja os erros vermelhos. Provavelmente é:
1. A API_BASE_URL não foi configurada (faz o passo 4.1 de novo)
2. Uma das chaves no Render está errada
3. Seu código tem um erro

---

## 🎉 Pronto!

Você conseguiu! Seu app está hospedado, seguro e funcional!

Se tiver dúvidas em qualquer passo, avise! 💪
