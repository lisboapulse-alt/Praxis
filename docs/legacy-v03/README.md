> **Perfil ativo: DEMO_UNRESTRICTED** — sem tetos locais de risco/ordens. Ver `docs/ALTERACOES_DEMO_V3.md`.

# PRAXIS OS — Pré-Codex v0.3 · Demo livre (Alpaca Paper + Ollama opcional)

**Esta é uma base técnica executável, não um robot já colocado a negociar.**

Foco: sistema simples, determinístico, exclusivamente Paper/Sandbox, com dashboard azul original TailAdmin, credenciais cifradas na VM, loop worker e diário SQLite WAL. Sem live trading nem endpoints de produção. Como não foi encontrado o repositório PRAXIS real, este ZIP é uma implementação complementar a integrar pelo Codex.

## O que está pronto

- Node 22.16+ nativo, sem dependências npm externas para backend experimental (requer `node:sqlite`, ainda experimental no Node 22).
- Auth com sessões revogáveis, header anti-CSRF para operações e secrets AES-256-GCM guardados na SQLite da VM.
- Adaptadores Alpaca Broker Sandbox e Trading Paper com endpoints hardcoded. Consulta de contas, saldo/posições, ordens, market data IEX para Trading Paper.
- Estratégia baseline SMA-5/20 de barras 1Min; executor **DESARMADO** por defeito; deduplicação por client ID e reconciliador.
- Integração opcional de `qwen3:1.7b` via Ollama em `127.0.0.1:11434`, isolado do OMS.
- Dashboard web com secções de Overview, Executor, Operations, Strategies, Risk, Research e Connections; curva de equity baseada em snapshots reais.

## Arranque local (somente ensaio)

```bash
node --version # 22.16 ou superior
npm test
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" # vault key
# Define em variáveis de ambiente os 3 segredos .env.example com valores gerados; não colar chaves num script versionado.
export PRAXIS_ADMIN_PASS='substituir-por-uma-frase-secreta-aleatoria-muito-longa'
export PRAXIS_SESSION_SECRET='substituir-por-outro-segredo-aleatorio-com-32-plus-caracteres'
export PRAXIS_VAULT_KEY='base64-32-bytes-da-chamada-node-acima'
export PRAXIS_DB='./state/praxis.sqlite'
npm start
```

Abrir `http://127.0.0.1:8787`. A primeira consulta só exige password de administrador. Liga chaves demo em `Ligações API`; as chaves anteriormente enviadas em chat devem ser renovadas. **Não colocar segredos no ZIP, no Git, no frontend ou no Netlify build.**

## Utilização segura

1. `Connections`: guardar/verificar keys (sem as expor depois).
2. `Executor`: descobrir contas, selecionar somente conta `ACTIVE/APPROVED` e manter `DISARMED` inicialmente.
3. `Executor`: consultar e testar Reconciliação; `Armar Paper` requer confirmação explícita.
4. `AUTO_PAPER` requer Trading Paper + Market Data IEX; só após todos os gates de `docs/STATUS_E_PENDENCIAS.md` forem concluídos.
5. `PARAR ORDENS`: desarma, não cancela ordens existentes e não liquida posições. Verificar ordens ainda abertas no broker.

## Deploy

Ver `docs/DEPLOY.md`, `ops/praxis.service` e `ops/Caddyfile.example`. Por simplicidade, a VM pode servir UI+API na mesma origem via Caddy; o Netlify pode servir só UI com proxy `/api/*` gerado por `npm` via `scripts/netlify-config.mjs`. Sem cloud acessível nesta sessão, não foi publicado nada.

## Testes

`npm test` e `npm run check`. Existe um teste E2E que inicia o servidor com secrets efémeros e valida sessões, bloqueio de ordens e ausência de acesso a código fonte.

## Não inclui

Modelo Ollama (pesos devem ser descarregados por Codex na VM), credenciais, banco de dados com dados reais, acesso cTrader, MT5, ligações verificadas à Alpaca, certificados SSL e performance fictícia. Ver `docs/STATUS_E_PENDENCIAS.md`.
