import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
await copyFile(new URL('../node_modules/fflate/esm/browser.js', import.meta.url), new URL('../public/vendor/fflate.js', import.meta.url));
await copyFile(new URL('../node_modules/fflate/LICENSE', import.meta.url), new URL('../public/vendor/fflate-LICENSE.txt', import.meta.url));
