// Vitest config (Sprint 3 / T3).
// Cobre apenas a suite nova em tests/integration/sprint3/**/*.test.js
// para nao conflitar com os scripts Node do Sprint 5 em tests/integration/.

module.exports = {
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/sprint3/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      reporter: ['text', 'html'],
      exclude: [
        'tests/**',
        'node_modules/**',
        'public/**',
        'scripts/**',
        'dist/**',
      ],
    },
  },
  poolOptions: {
    forks: { singleFork: true },
  },
};
