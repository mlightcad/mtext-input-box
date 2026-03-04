import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Alias } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => {
  const aliases: Alias[] = [];
  if (command === 'serve') {
    aliases.push({
      find: '@mlightcad/text-box-cursor',
      replacement: path.resolve(__dirname, '../text-box-cursor/src/index.ts')
    });
  }

  return {
    server: {
      port: 5173,
      fs: {
        allow: [path.resolve(__dirname, '..')]
      }
    },
    ...(aliases.length > 0 ? { resolve: { alias: aliases } } : {}),
    optimizeDeps: {
      exclude: ['@mlightcad/text-box-cursor']
    }
  };
});
