# PRAXIS Fase A — Dados de Mercado / Auditoria de Implementação

## O que mudou na v0.4.2-phase-a

1. `src/adapters.mjs`: endpoints de dados separados para Alpaca Trading Paper e Broker Sandbox, autenticação legacy Basic / OAuth Client Credentials Broker, paginação completa de candles, ajuste raw/split/dividend/all e identificação explícita de resultados parciais. `fills` Broker corrigido para `/v1/accounts/activities?account_id=...&activity_types=FILL`.
2. `src/streams.mjs`: SSE de ordens Broker em `/v2/events/trades`, cursores ULID `since_id`, aviso sobre eventos perdidos, Market Data Broker Sandbox WebSocket e separação das credenciais. Streaming para contas Paper permanece disponível.
3. `src/market-quality.mjs`: diagnóstico de integridade, timestamps futuros e lacunas *candidatas* intrassessão, sem inventar um calendário de bolsa.
4. `src/storage.mjs`: tabela `market_imports` com proveniência, ajustes, período, número de páginas, contagem e diagnóstico.
5. `src/market-poller.mjs` e `src/server.mjs`: recolha automática **apenas de leitura** de uma seleção limitada da watchlist, a cada cinco minutos. Funciona desarmado, não envia ordens.
6. `scripts/backfill-market.mjs`: histórico de longa duração em janelas pequenas, utilizando credenciais guardadas no cofre do backend, sem introduzir segredos em comandos.
7. `src/api-extra.mjs`: `/api/markets/data` aceita Broker Sandbox ou Trading Paper, datas, ajustamento; quando `start` é fornecido usa importação paginada e limita resultados devolvidos ao browser, guardando tudo no SQLite. `/api/markets/quality` devolve registos de ingestão.
8. `public/index.html` / `public/modules.js`: opção de autenticação da Broker, datas, ajustes, qualidade e histórico parcial; paleta original TailAdmin.

## Testes locais

Executados com **Node 22.16.0** apesar do projeto exigir Node >=24 em produção. Foram aprovados 56 testes sem as dependências de WebSocket/browser: 47 testes preexistentes + 9 novos da Fase A. As dependências `ws`/`https-proxy-agent` e Chromium não puderam ser obtidas neste ambiente, pelo que a suíte completa, WebSocket e E2E têm de ser repetidos pelo Codex numa máquina Node 24 com `npm ci`. Estes testes **não verificam credenciais de corretora reais**.

## Comandos

```bash
npm ci
npm run check
npm test
npm run build
node scripts/backfill-market.mjs SPY 1Day 2020-01-01 2026-10-14 alpaca-trading-paper all
```

O script `backfill-market.mjs` usa `PRAXIS_DB` e `PRAXIS_VAULT_KEY`, recuperando a ligação previamente guardada em Broker Connections. Nunca passar chaves em argumentos CLI.

## Endpoints e diagnósticos

- `GET /api/markets/data?symbol=AAPL&timeframe=1Min`: janela recente, origem/qualidade identificadas.
- `GET /api/markets/data?symbol=AAPL&timeframe=1Day&start=2024-01-01&end=2026-01-01&adjustment=all&maxBars=10000`: importação paginada com persistência; `complete=false` e `nextPageToken` se exceder limite.
- `GET /api/markets/quality?source=alpaca-iex&symbol=AAPL`: qualidade/proveniência do histórico importado.
- `GET /api/markets/history?source=alpaca-iex&symbol=AAPL&timeframe=1Day`: armazenamento local (ainda limitado a 10000 linhas por resposta).

## Limites conhecidos / próximos testes

- **Calendário:** dias de férias/feriados, suspensões e mudanças de horário necessitam de calendário oficial para classificar definitivamente gaps. Não confundir lacuna *candidata* com falha confirmada.
- **Feeds:** IEX não equivale a SIP; Level 2 não está implementado. Streams livres podem limitar subscrições (30 símbolos Trading Basic); limites e permissões da conta Broker podem ser diferentes.
- **Metadados de corporate actions:** ainda não se mantém uma tabela própria de splits/dividendos. A API permite solicitar os ajustes, e cada série ajustada é guardada sob uma origem separada.
- **Conexões:** credenciais reais não foram usadas nem testadas. Validar OAuth e WebSocket Broker/Trading numa VM com rede e conta autorizada.
- **Continuidade:** confirmar rate limits reais, fecho/abertura, reconexão SSE e WebSocket, correções de candles e saúde durante vários dias.
- **Não foi alterado o envio de ordens** nesta fase; motor DEMO desarmado por defeito.

## Fontes oficiais consultadas

- https://docs.alpaca.markets/us/docs/authentication
- https://docs.alpaca.markets/us/docs/about-market-data-api
- https://docs.alpaca.markets/us/reference/stockbars
- https://docs.alpaca.markets/us/reference/getaccountactivities
- https://docs.alpaca.markets/us/reference/subscribetotradev2sse
- https://docs.alpaca.markets/us/docs/streaming-market-data
