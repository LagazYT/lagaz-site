// Robô do site Lagaz: lê os feeds de fontes.json e grava noticias.json.
// Guarda título, trecho curto, link da matéria e o endereço da imagem (sem copiar o arquivo).
import { readFile, writeFile } from "node:fs/promises";

const MAX = 30;
const UA = { "User-Agent": "Mozilla/5.0 (robo-lagaz)" };
const raiz = new URL("../", import.meta.url);
const fontes = JSON.parse(await readFile(new URL("fontes.json", raiz), "utf8"));

let antigas = [];
try { antigas = JSON.parse(await readFile(new URL("noticias.json", raiz), "utf8")).noticias || []; } catch {}
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

if (!noticias.length) {
  console.log("Nenhuma notícia encontrada; mantendo o noticias.json atual.");
  process.exit(1);
}
await writeFile(
  new URL("noticias.json", raiz),
  JSON.stringify({ atualizadoEm: new Date().toISOString(), noticias }, null, 2),
);
console.log(`Gravadas ${noticias.length} notícias.`);
