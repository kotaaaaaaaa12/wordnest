import { readFile, writeFile, copyFile } from 'node:fs/promises';
const names={
  guide:'circle-help', up:'chevron-up', down:'chevron-down', settings:'settings', book:'book-open', edit:'pencil-line', arrow:'arrow-right', back:'arrow-left', plus:'plus', download:'download', upload:'upload', check:'check', close:'x', search:'search', sound:'volume-2', mute:'volume-x', lock:'lock-keyhole', trash:'trash-2', trophy:'trophy', refresh:'rotate-cw', leaf:'sprout', cards:'layers', quiz:'clipboard-check', flip:'flip-horizontal-2', timer:'timer', sort:'list-ordered', sparkles:'sparkles'
};
const nodes={};
for(const [key,name] of Object.entries(names)){
  const svg=await readFile(new URL(`../node_modules/lucide-static/icons/${name}.svg`,import.meta.url),'utf8');
  nodes[key]=svg.slice(svg.indexOf('>',svg.indexOf('<svg'))+1,svg.lastIndexOf('</svg>')).trim().replace(/\s+/g,' ');
}
const module=`// Lucide icon geometry. See vendor/lucide-LICENSE.txt.\nconst nodes=${JSON.stringify(nodes,null,2)};\nexport const icon = name => \`<svg class="ui-icon" aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">\${nodes[name] || nodes.book}</svg>\`;\n`;
await writeFile(new URL('../public/icons.js',import.meta.url),module);
await copyFile(new URL('../node_modules/lucide-static/LICENSE',import.meta.url),new URL('../public/vendor/lucide-LICENSE.txt',import.meta.url));
await writeFile(new URL('../public/favicon.svg',import.meta.url),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="14" fill="#d95835"/><g transform="translate(10 9) scale(1.1667)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${nodes.book}</g></svg>\n`);
