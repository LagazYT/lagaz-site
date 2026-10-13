# Site Lagaz com robô de notícias

O robô lê feeds de notícias em português a cada 3 horas, grava `noticias.json`
e o site mostra tudo sozinho. Ele guarda só título, trecho curto e link da matéria original.

## Colocar no ar (GitHub, grátis)
1. Crie uma conta em github.com e clique em **New repository**. Nome sugerido: `lagaz-site`, marque **Public**.
2. Em **uploading an existing file**, arraste TODO o conteúdo desta pasta, incluindo a pasta `.github`
   (se ela não aparecer, ative "mostrar itens ocultos" no Windows). Clique em **Commit changes**.
3. Em **Settings > Pages**: Source = *Deploy from a branch*, Branch = `main`, pasta `/ (root)`. Salve.
4. Em **Settings > Actions > General > Workflow permissions**: marque *Read and write permissions*. Salve.
5. Em **Actions > Atualizar notícias > Run workflow** para rodar o robô agora.
6. Seu site fica em `https://SEU-USUARIO.github.io/lagaz-site/` (leva uns minutos na primeira vez).

## Personalizar
- **Fontes de notícia:** edite `fontes.json` e adicione `{ "nome": "...", "url": "link do feed RSS" }`.
- **Vídeos e link do canal:** no começo do `<script>` do `index.html` (`LINK_CANAL` e `VIDEOS`).
- **Horário do robô:** linha `cron` em `.github/workflows/atualizar-noticias.yml`.
