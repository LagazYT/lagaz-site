// Robô do site Lagaz: lê os feeds de fontes.json e grava noticias.json.
// Guarda título, trecho curto, link da matéria e o endereço da imagem (sem copiar o arquivo).
import { readFile, writeFile } from "node:fs/promises";

const MAX = 30;
const CANAL_ID = "UC9xrr5otocpH79WIHu_JX4Q"; // canal Lagaz (@lagazoficial)
const UA = { "User-Agent": "Mozilla/5.0 (robo-lagaz)" };
const raiz = new URL("../", import.meta.url);
const fontes = JSON.parse(await readFile(new URL("fontes.json", raiz), "utf8"));

let dadosAntigos = {};
try { dadosAntigos = JSON.parse(await readFile(new URL("noticias.json", raiz), "utf8")); } catch {}
const antigas = dadosAntigos.noticias || [];
const cache = new Map(antigas.map((n) => [n.orig || n.link, n]));

const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, "&");
const semCdata = (s) => (s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const limpa = (s) => decode(semCdata(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pega = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
};

const urlImagem = (u) => {
  const x = (u || "").trim().replace(/^http:\/\//i, "https://");
  return /^https:\/\/\S+$/.test(x) ? x : "";
};
function imagemDoItem(b, html) {
  const achados = [
    (b.match(/<News:Image>\s*([^<\s]+)\s*<\/News:Image>/i) || [])[1],
    (b.match(/<media:content[^>]*url="([^"]+)"/i) || [])[1],
    (b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) || [])[1],
    (b.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i) || [])[1],
    (b.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) || [])[1],
    (html.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1],
  ];
  for (const a of achados) {
    const u = urlImagem(decode(a || ""));
    if (u) return u;
  }
  return "";
}

// Links do Google Notícias: descobre o endereço real da matéria.
async function decodificaGoogle(link) {
  const id = new URL(link).pathname.split("/").pop();
  let s = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
  if (s.startsWith("\x08\x13\x22")) s = s.slice(3);
  if (s.endsWith("\xd2\x01\x00")) s = s.slice(0, -3);
  const tam = s.charCodeAt(0);
  s = tam >= 0x80 ? s.slice(2, tam + 2) : s.slice(1, tam + 1);
  if (/^https?:\/\//.test(s)) return s;
  // formato novo: pergunta ao próprio Google
  const opc = { headers: UA, signal: AbortSignal.timeout(15000) };
  const pagina = await (await fetch(`https://news.google.com/articles/${id}`, opc)).text();
  const sg = (pagina.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (pagina.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) return "";
  const interno = JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sg]);
  const corpo = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", interno]]]));
  const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST", body: corpo, signal: AbortSignal.timeout(15000),
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
  const m = (await r.text()).match(/garturlres\\+",\\+"(https?:\/\/[^"\\]+)/);
  return m ? m[1].replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) : "";
}
async function desembrulha(link) {
  try {
    const u = new URL(link);
    if (/(^|\.)bing\.com$/.test(u.hostname)) {
      const real = u.searchParams.get("url");
      return real && /^https?:\/\//.test(real) ? real : link;
    }
    if (u.hostname === "news.google.com" && /\/articles\//.test(u.pathname)) return (await decodificaGoogle(link)) || link;
  } catch {}
  return link;
}

// Plano B: abre a página da matéria e lê a imagem de capa (og:image).
async function imagemDaPagina(link) {
  try {
    if (/(^|\.)google\.com$/.test(new URL(link).hostname)) return "";
    const r = await fetch(link, { headers: UA, signal: AbortSignal.timeout(10000), redirect: "follow" });
    if (!r.ok) return "";
    const html = (await r.text()).slice(0, 200000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    return m ? urlImagem(decode(m[1])) : "";
  } catch { return ""; }
}

// Vídeos do canal. Ordem de tentativas:
// 1) API oficial do YouTube (só se existir a chave YOUTUBE_API_KEY; traz também os mais vistos de todos os tempos)
// 2) feed do canal  3) feed da lista de envios (o YouTube às vezes dá 404 para um e funciona no outro)
const linkVideo = (id) => `https://www.youtube.com/watch?v=${id}`;
const imgVideo = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function baixaFeed(url) {
  let ultimo;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, {
        headers: { ...UA, Accept: "application/atom+xml,text/xml,*/*", "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) return await r.text();
      ultimo = new Error(`HTTP ${r.status}`);
    } catch (e) { ultimo = e; }
    await esperar(2000);
  }
  throw ultimo;
}

function videosDoFeed(xml) {
  return (xml.match(/<entry[\s\S]*?<\/entry>/gi) || []).map((b) => {
    const id = limpa(pega(b, "yt:videoId"));
    return {
      id, t: limpa(pega(b, "title")), data: limpa(pega(b, "published")),
      views: Number((b.match(/<media:statistics[^>]*views="(\d+)"/i) || [])[1] || 0),
      img: imgVideo(id), link: linkVideo(id),
    };
  }).filter((v) => /^[\w-]{11}$/.test(v.id) && v.t);
}

async function videosPelaApi(chave) {
  const base = "https://www.googleapis.com/youtube/v3";
  const q = async (u) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`API HTTP ${r.status}`);
    return r.json();
  };
  const busca = (ordem) => q(`${base}/search?part=snippet&channelId=${CANAL_ID}&order=${ordem}&type=video&maxResults=15&key=${chave}`);
  const [recentes, populares] = [await busca("date"), await busca("viewCount")];
  const ids = [...new Set([...recentes.items, ...populares.items].map((i) => i.id && i.id.videoId).filter(Boolean))];
  const det = await q(`${base}/videos?part=snippet,statistics&id=${ids.join(",")}&key=${chave}`);
  return det.items.map((v) => ({
    id: v.id, t: v.snippet.title, data: v.snippet.publishedAt,
    views: Number(v.statistics.viewCount || 0), img: imgVideo(v.id), link: linkVideo(v.id),
  })).sort((a, b) => b.data.localeCompare(a.data));
}

async function lerVideos() {
  const chave = process.env.YOUTUBE_API_KEY;
  if (chave) {
    try { return await videosPelaApi(chave); }
    catch (e) { console.log(`AVISO API do YouTube: ${e.message}; tentando os feeds.`); }
  }
  let erro;
  for (const url of [
    `https://www.youtube.com/feeds/videos.xml?channel_id=${CANAL_ID}`,
    `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CANAL_ID.slice(2)}`,
  ]) {
    try {
      const v = videosDoFeed(await baixaFeed(url));
      if (v.length) return v;
      erro = new Error("feed vazio");
    } catch (e) { erro = e; }
  }
  throw erro;
}

// Próximos lançamentos (IGDB, via Twitch). Precisa de TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET.
const PLATAFORMAS = { win: "PC", ps5: "PS5", "series-x-s": "Xbox", xboxone: "Xbox", switch: "Switch", "switch-2": "Switch 2" };
async function igdb(token, clientId, endpoint, corpo) {
  const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": clientId, Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: corpo, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`IGDB HTTP ${r.status}`);
  return r.json();
}
async function lerLancamentos(clientId, segredo) {
  const t = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(segredo)}&grant_type=client_credentials`,
    { method: "POST", signal: AbortSignal.timeout(20000) },
  );
  if (!t.ok) throw new Error(`Twitch HTTP ${t.status} (confira o Client ID e o Secret)`);
  const token = (await t.json()).access_token;
  const slugs = Object.keys(PLATAFORMAS).map((x) => `"${x}"`).join(",");
  const plats = await igdb(token, clientId, "platforms", `fields id,name,slug; where slug = (${slugs}); limit 30;`);
  const rotulo = new Map(plats.filter((p) => PLATAFORMAS[p.slug]).map((p) => [p.id, PLATAFORMAS[p.slug]]));
  console.log(`Plataformas encontradas: ${[...new Set(plats.map((p) => p.slug))].join(", ") || "nenhuma"}`);
  if (!rotulo.size) throw new Error("nenhuma plataforma encontrada");
  const agora = Math.floor(Date.now() / 1000);
  const ate = agora + 400 * 86400;
  const jogos = await igdb(token, clientId, "games",
    `fields name,first_release_date,hypes,cover.image_id,platforms,url; ` +
    `where first_release_date > ${agora} & first_release_date < ${ate} & platforms = (${[...rotulo.keys()].join(",")}) & hypes > 0 & version_parent = null; ` +
    `sort first_release_date asc; limit 500;`);
  return jogos.filter((g) => g.name && g.cover && g.cover.image_id).map((g) => ({
    t: g.name,
    data: new Date(g.first_release_date * 1000).toISOString().slice(0, 10),
    plats: [...new Set((g.platforms || []).map((p) => rotulo.get(p)).filter(Boolean))],
    img: `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`,
    hype: g.hypes || 0,
    link: /^https:\/\//.test(g.url || "") ? g.url : "",
  })).slice(0, 400);
}

const regras = [
  ["Ofertas", /promo|desconto|oferta|de graça|gratuito|grátis|black friday/i],
  ["PC", /\bpc\b|nvidia|rtx|\bamd\b|steam|placa de v[ií]deo|\bfps\b|dlss|fsr/i],
  ["Consoles", /playstation|\bps[45]\b|xbox|nintendo|switch/i],
  ["Eventos", /evento|showcase|direct\b|gamescom|summer game fest|game awards|\bbgs\b/i],
  ["Lançamentos", /lan[çc]a|trailer|data de|anunci|chega|revela/i],
];
const categoria = (txt) => (regras.find(([, r]) => r.test(txt)) || ["Geral"])[0];

async function lerFeed(fonte) {
  const resp = await fetch(fonte.url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xml = await resp.text();
  const filtro = fonte.filtro ? new RegExp(fonte.filtro, "i") : null;
  const blocos = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  const itens = blocos.map((b) => {
    let titulo = limpa(pega(b, "title"));
    const link = limpa(pega(b, "link")) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "";
    const origem = limpa(pega(b, "source")) || fonte.nome;
    if (origem && titulo.endsWith(" - " + origem)) titulo = titulo.slice(0, -(origem.length + 3));
    const bruto = decode(semCdata(pega(b, "content:encoded") || pega(b, "description") || pega(b, "summary")));
    let resumo = limpa(pega(b, "description") || pega(b, "summary"));
    if (resumo.startsWith(titulo)) resumo = resumo.slice(titulo.length).trim();
    if (resumo.length > 200) resumo = resumo.slice(0, 197).replace(/\s+\S*$/, "") + "...";
    const quando = new Date(limpa(pega(b, "pubDate") || pega(b, "published") || pega(b, "updated")));
    return {
      t: titulo, d: resumo, link, fonte: origem,
      data: isNaN(quando) ? new Date().toISOString() : quando.toISOString(),
      c: categoria(titulo + " " + resumo),
      img: imagemDoItem(b, bruto),
    };
  }).filter((n) => n.t && /^https?:\/\//.test(n.link) && (!filtro || filtro.test(n.t + " " + n.d)));
  // limite por fonte, para o Google Notícias não ocupar o site inteiro
  const limite = /(^|\.)google\.com$/.test(new URL(fonte.url).hostname) ? 5 : 10;
  return itens.sort((x, y) => y.data.localeCompare(x.data)).slice(0, limite);
}

let todas = [];
for (const f of fontes) {
  try {
    const itens = await lerFeed(f);
    console.log(`OK   ${f.nome}: ${itens.length} itens`);
    todas = todas.concat(itens);
  } catch (e) {
    console.log(`ERRO ${f.nome}: ${e.message}`);
  }
}

const vistos = new Set();
const noticias = todas
  .sort((a, b) => b.data.localeCompare(a.data))
  .filter((n) => {
    const chave = n.t.toLowerCase().replace(/\W+/g, " ").trim();
    if (vistos.has(chave) || vistos.has(n.link)) return false;
    vistos.add(chave); vistos.add(n.link);
    return true;
  })
  .slice(0, MAX);

let resolvidos = 0;
for (let i = 0; i < noticias.length; i += 3) {
  await Promise.all(noticias.slice(i, i + 3).map(async (n) => {
    const antiga = cache.get(n.link);
    if (antiga && antiga.orig) { // já resolvido numa rodada anterior
      n.orig = n.link; n.link = antiga.link;
      if (!n.img && antiga.img) n.img = antiga.img;
      return;
    }
    if (antiga && antiga.img && !n.img) n.img = antiga.img;
    const real = await desembrulha(n.link);
    if (real !== n.link) { n.orig = n.link; n.link = real; resolvidos++; }
  }));
}
console.log(`Links do Google/Bing resolvidos: ${resolvidos}.`);
const semImagem = noticias.filter((n) => !n.img);
for (let i = 0; i < semImagem.length; i += 5) {
  await Promise.all(semImagem.slice(i, i + 5).map(async (n) => { n.img = await imagemDaPagina(n.link); }));
}
console.log(`Imagens: ${noticias.filter((n) => n.img).length} de ${noticias.length} notícias.`);

let videos = dadosAntigos.videos || [];
try {
  const novos = await lerVideos();
  if (novos.length) videos = novos;
  console.log(`OK   Canal Lagaz (YouTube): ${novos.length} vídeos`);
} catch (e) {
  console.log(`ERRO Canal Lagaz (YouTube): ${e.message} (mantendo os vídeos anteriores)`);
}

let lancamentos = dadosAntigos.lancamentos || [];
const idTwitch = process.env.TWITCH_CLIENT_ID, segredoTwitch = process.env.TWITCH_CLIENT_SECRET;
if (idTwitch && segredoTwitch) {
  try {
    const novos = await lerLancamentos(idTwitch, segredoTwitch);
    if (novos.length) lancamentos = novos;
    console.log(`OK   Lançamentos (IGDB): ${novos.length} jogos`);
  } catch (e) {
    console.log(`ERRO Lançamentos (IGDB): ${e.message} (mantendo os anteriores)`);
  }
} else {
  console.log("AVISO Lançamentos: TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET não configurados; pulando.");
}

if (!noticias.length) {
  console.log("Nenhuma notícia encontrada; mantendo o noticias.json atual.");
  process.exit(1);
}
await writeFile(
  new URL("noticias.json", raiz),
  JSON.stringify({ atualizadoEm: new Date().toISOString(), noticias, videos, lancamentos }, null, 2),
);
console.log(`Gravadas ${noticias.length} notícias.`);
