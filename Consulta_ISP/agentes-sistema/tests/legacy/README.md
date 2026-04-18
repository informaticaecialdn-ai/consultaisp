# Legacy test scripts

Scripts plain-Node preservados de sprints antigos (test-integration.js, test-e2e-mocked.js).
A partir do Sprint 3 a suite oficial e **Vitest** em `tests/integration/sprint3/`.

Estes arquivos **nao sao executados por `npm test`**. Rode manualmente se precisar:

```sh
node tests/legacy/test-integration.js
```

Nao adicione testes novos aqui — crie em `tests/integration/sprint3/` usando Vitest.
