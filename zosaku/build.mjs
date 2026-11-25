// 単一HTML（zosaku/index.html）を作る。実行： npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const VER = '1.2';

const result = await build({
  entryPoints: [join(here, 'src/ui/app.js')],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false,
  legalComments: 'none', charset: 'utf8'
});
const js = result.outputFiles[0].text.replaceAll('__VER__', VER).replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(here, 'src/ui/style.css'), 'utf8');
const html = readFileSync(join(here, 'src/ui/index.template.html'), 'utf8')
  .replaceAll('__VER__', VER)
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);
writeFileSync(join(here, 'index.html'), html);
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB（Ver${VER}）`);
