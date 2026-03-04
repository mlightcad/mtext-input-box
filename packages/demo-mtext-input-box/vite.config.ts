import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Alias } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
  const aliases: Alias[] = [];
  if (command === 'serve') {
    aliases.push({
      find: /^@mlightcad\/(mtext-input-box|text-box-cursor)$/,
      replacement: path.resolve(__dirname, '../$1/src/index.ts')
    });
  }

  return {
  base: './',
  server: {
    port: 5175,
    fs: {
      allow: [path.resolve(__dirname, '..')]
    }
  },
  ...(aliases.length > 0 ? { resolve: { alias: aliases } } : {}),
  optimizeDeps: {
    exclude: ['@mlightcad/mtext-input-box', '@mlightcad/text-box-cursor']
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/mtext-renderer/dist/mtext-renderer-worker.js',
          dest: 'assets'
        }
      ]
    })
  ]
  };
});
