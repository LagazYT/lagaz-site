// Robô do site Lagaz: lê os feeds de fontes.json e grava noticias.json.
// Guarda só título, um trecho curto e o link da matéria original.
import { readFile, writeFile } from "node:fs/promises";

const MAX = 30;
const fontes = JSON.parse(await readFile(new URL("../fontes.json", import.meta.url), "utf8"));

const decode = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, "&");
const limpa = (s) => decode((s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pega = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
};

const regras = [
  ["Ofertas", /promo|desconto|oferta|de graça|gratuito|grátis|black friday/i],
  ["PC", /\bpc\b|nvidia|rtx|\bamd\b|steam|placa de v[ií]deo|\bfps\b|dlss|fsr/i],
  ["Consoles", /playstation|\bps[45]\b|xbox|nintendo|switch/i],
  ["Eventos", /evento|showcase|direct\b|gamescom|summer game fest|game awards|\bbgs\b/i],
  ["Lançamentos", /lan[çc]a|trailer|data de|anunci|chega|revela/i],
];
const categoria = (txt) => (regras.find(([, r]) => r.test(txt)) || ["Geral"])[0];

async function lerFeed(fonte) {
  const resp = await fetch(fonte.url, {
    headers: { "User-Agent": "Mozilla/5.0 (robo-lagaz)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xml = await resp.text();
  const blocos = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocos.map((b) => {
    let titulo = limpa(pega(b, "title"));
    let link = limpa(pega(b, "link")) || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || "";
    const origem = limpa(pega(b, "source")) || fonte.nome;
    if (origem && titulo.endsWith(" - " + origem)) titulo = titulo.slice(0, -(origem.length + 3));
    let resumo = limpa(pega(b, "description") || pega(b, "summary"));
    if (resumo.startsWith(titulo)) resumo = resumo.slice(titulo.length).trim();
    if (resumo.length > 200) resumo = resumo.slice(0, 197).replace(/\s+\S*$/, "") + "...";
    const quando = new Date(limpa(pega(b, "pubDate") || pega(b, "published") || pega(b, "updated")));
    return {
      t: titulo, d: resumo, link, fonte: origem,
      data: isNaN(quando) ? new Date().toISOString() : quando.toISOString(),
      c: categoria(titulo + " " + resumo),
    };
  }).filter((n) => n.t && /^https?:\/\//.test(n.link));
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

if (!noticias.length) {
  console.log("Nenhuma notícia encontrada; mantendo o noticias.json atual.");
  process.exit(1);
}
await writeFile(
  new URL("../noticias.json", import.meta.url),
  JSON.stringify({ atualizadoEm: new Date().toISOString(), noticias }, null, 2),
);
console.log(`Gravadas ${noticias.length} notícias.`);
