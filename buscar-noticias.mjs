// Robô do site Lagaz: lê os feeds de fontes.json e grava noticias.json.
// Guarda título, trecho curto, link da matéria e o endereço da imagem (sem copiar o arquivo).
import { readFile, writeFile } from "node:fs/promises";

const MAX = 30;
const UA = { "User-Agent": "Mozilla/5.0 (robo-lagaz)" };
const raiz = new URL("../", import.meta.url);
const fontes = JSON.parse(await readFile(new URL("fontes.json", raiz), "utf8"));

let antigas = [];
try { antigas = JSON.parse(await readFile(new URL("noticias.json", raiz), "utf8")).noticias || []; } catch {}
const imagemAntiga = new Map(antigas.filter((n) => n.img).map((n) => [n.link, n.img]));

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
  return blocos.map((b) => {
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

for (const n of noticias) if (!n.img && imagemAntiga.has(n.link)) n.img = imagemAntiga.get(n.link);
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
