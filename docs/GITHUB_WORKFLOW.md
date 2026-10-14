# PRAXIS OS — fluxo de trabalho via GitHub

## Objectivo

O repositório GitHub é a fonte canónica do código PRAXIS. Alterações devem passar por branches pequenas, testes e pull requests antes do merge em `main`. O motor na cloud permanece independente do processo de desenvolvimento.

## Primeira publicação

1. Criar um repositório **privado** chamado `praxis-os` na conta GitHub ligada ao ChatGPT. Inicializar com README (cria a branch `main`).
2. No ChatGPT, fornecer a ligação HTTPS real ao repositório. O assistente poderá consultar e alterar o código através do conector GitHub, sem usar Codex.
3. Publicar os ficheiros deste pacote, excluindo sempre `.env`, `state/`, `secrets/`, `node_modules/` e `reports/`.
4. Confirmar que `npm ci`, `npm run check`, `npm test` e `npm run build` passam na GitHub Actions antes de fazer o primeiro deploy.

## Política de alterações

- `main`: referência estável, sem edição destrutiva dos dados.
- `feature/`: funcionalidades novas; `fix/`: correções; `audit/`: auditorias.
- Preferir PRs com descrição e evidência de testes. Não marcar como concluídos testes não executados.
- Não incluir credenciais em comentários, commits, issues ou prompts. Credenciais são configuradas no servidor por interface autenticada e guardadas cifradas.
- Alterações ao trading começam em execução desarmada e estritamente sandbox/paper. Não configurar endpoints Live.
- Dados de mercado, históricos SQLite e logs ficam fora do Git. A GitHub Actions valida o código, não aloja nem executa o robot 24/7.

## CI, operação e deploy

A workflow `.github/workflows/ci.yml` valida Node 24, npm install, build, check, testes e Playwright. Não configurar deploy automático com ordens armadas até a ligação real, reconciliação e retoma pós-falha terem sido validadas.

Netlify serve a dashboard; um servidor persistente executa o backend e serviços de mercado. Nunca publicar as portas do Ollama/SQLite e nunca expor o segredo de cifra em variáveis de frontend.

## Estado de partida

Versão `0.4.2-phase-a`. Os relatórios originais de testes do arquivo v0.4.2 são históricos e **não** garantem que as mesmas verificações passem no GitHub. A primeira execução da CI é a prova reproduzível.
