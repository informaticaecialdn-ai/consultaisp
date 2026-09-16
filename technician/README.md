# App do técnico — aplicação independente

Este PWA tem HTML, build, servidor e domínio próprios. Não é uma página embutida no Consulta ISP. Reutiliza apenas componentes de campo e o contrato tipado da API; o painel de gestão permanece no sistema principal.

## Local

- API e painel: `npm run dev` na porta 5000 (com PostgreSQL e configuração existentes).
- PWA: `npm run technician:dev`, em `http://127.0.0.1:5001`.
- Build separado: `npm run technician:build`, saída `dist-technician/`.
- Tipos do app: `npx tsc -p technician/tsconfig.json`.
- Use usuário do próprio provedor. O app pede `scope=mine` e só exibe atividades atribuídas a esse usuário, inclusive quando ele é administrador.

Em localhost os cookies não são isolados por porta. Em produção, publique em host separado para que a sessão do PWA seja independente da sessão do painel.

## Publicação no domínio próprio

1. Defina o domínio final do PWA, DNS e certificado TLS.
2. Publique somente `dist-technician/`, em uma implantação separada da aplicação principal.
3. Configure o proxy de mesma origem de `deploy/nginx.conf.template` com a origem HTTPS e host canônicos da API já aceitos pelo backend. Restrinja o acesso aos endpoints de autenticação e execução de campo. Não exponha o proxy como destino arbitrário controlado pelo navegador.
4. Defina `VITE_TECHNICIAN_APP_URL` no build do painel principal para abrir esse domínio no botão “Abrir app do técnico”. Sem configuração, o link em produção fica indisponível.
5. Confirme login, cookie Secure/httpOnly, encerramento de sessão, isolamento entre usuários/provedores e instalação em Android/iOS no domínio final. O service worker só é registrado no build de produção e nunca guarda APIs ou fotografias em cache.

O domínio não foi escolhido nem publicado automaticamente. O proxy do desenvolvimento é uma conveniência local, não servidor de produção.

## Operação

Gestor abre um caso no kanban → seleciona visitas em `/recuperacao/operacao` → escolhe responsável e saída → ordena por proximidade → distribui. O técnico vê sua agenda atualizada a cada 30 segundos, abre o endereço na navegação, confere série/MAC/patrimônio e registra o resultado com fotos, relato, GPS ou justificativa de indisponibilidade. Uma coleta confirmada move o equipamento para `recuperado_triagem`; uma visita sem coleta move o caso para `nova_tentativa` e preserva a próxima ação nas evidências. Visitas não publicam sinais no bureau.

## Limites explícitos

- Ordenação por distância em linha reta, até 30 casos. Não calcula trajeto viário, trânsito, capacidade por jornada, janelas de atendimento ou ETA.
- Fotos: até 3 por visita, convertidas localmente para JPEG de no máximo 500 KB. Guardadas atomicamente com o evento no PostgreSQL atual; leitura por endpoint autenticado. O backup do PostgreSQL deve incluir esses eventos. Para grande volume, evoluir para armazenamento privado de objetos com verificação de vínculo e política de retenção definida pelo provedor.
- Registro sem conexão permanece apenas no formulário aberto; não há fila offline persistente, background sync ou push. Não feche a página antes da confirmação do envio. A tela offline informa essa limitação. O mesmo `requestId` pode ser reenviado após falha sem duplicar uma visita já salva.
- “Não encontrado” é relato de visita, não prova automática de fraude. GPS e precisão são informados pelo dispositivo e não são atestado antifalsificação.
- A regra legada de prazo, encerramento e publicação no bureau foi preservada. Visitas contestadas ou encerradas exigem revisão do gestor.
- API retorna até 2.000 casos recentes e 100 visitas por caso. O painel informa o limite quando atingido.
