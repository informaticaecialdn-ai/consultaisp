import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  test: {
    // O client tambem entra. So o server estava incluido, entao um teste posto
    // em client/ era coletado por ninguem e passava despercebido — o arquivo
    // existia, `npm test` dizia tudo verde, e nada daquilo tinha rodado.
    // Somente .test.ts: o que esta em client/ e logica pura (derivacao do
    // relatorio, formatadores). Componente .tsx exigiria ambiente de DOM, que
    // este projeto ainda nao configura.
    // script/ entra pelo mesmo motivo: o teste do dominio-whitelabel.sh roda o
    // script de deploy de verdade, e fora do include ele nunca seria coletado.
    include: ['server/**/*.test.ts', 'client/**/*.test.ts', "shared/**/*.test.ts", 'script/**/*.test.ts'],
  },
});
