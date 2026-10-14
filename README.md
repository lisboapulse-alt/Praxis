# PRAXIS OS v0.4.2 — Fase A Market Data · DEMO_UNRESTRICTED

> **Repositório principal:** usar GitHub como fonte canónica de código. O fluxo está documentado em [GitHub Workflow](docs/GITHUB_WORKFLOW.md) e as verificações pendentes em [Fase A Backlog](docs/PROXIMOS_PASSOS_FASE_A.md). Não guardar credenciais, bases SQLite ou logs no repositório.

Plataforma modular de investigação e execução **exclusivamente fictícia**. Um backend persistente Node 24 LTS com SQLite WAL, interface TailAdmin e Ollama local. Endpoints Live não são configuráveis.

## Arranque local

```bash
npm ci
npm run build
node scripts/init-secrets.mjs
node --env-file=.env src/server.mjs
```

Abrir `http://127.0.0.1:8787`. A palavra-passe é `PRAXIS_ADMIN_PASS` no ficheiro privado `.env`; o gerador não imprime segredos. O servidor inicia desarmado, sem chaves broker. Introduzir credenciais **renovadas** na dashboard; nunca incluir chaves no código, prompts ou Netlify. Para ambiente local HTTP, `PRAXIS_COOKIE_SECURE=0`; produção HTTPS usa `1`.

O material anterior incluía benchmarks do Ollama em ambiente de desenvolvimento; não há implantação Oracle nem prova de disponibilidade durante 60 dias nesta entrega. Os resultados antigos permanecem identificados como baseline v0.4.1 nos relatórios.

## Fase A — Market Data (implementação local)

- Alpaca Trading Paper: IEX histórico/trades/quotes/stream em `data.alpaca.markets`.
- Alpaca Broker Sandbox: dados separados em `data.sandbox.alpaca.markets`, Basic legado ou OAuth client credentials com token em memória.
- Importação histórica REST paginada com `next_page_token`, deduplicação por timestamp, falha explícita em conflitos, limite máximo 50 000 candles/pedido.
- Importação de intervalos grandes via CLI em blocos, sem chaves na linha de comandos:

```bash
node scripts/backfill-market.mjs AAPL 1Day 2019-01-01 2026-10-14 alpaca-trading-paper all
```

- SQLite WAL: candles indexados por origem, feed, broker e ajustamento; registo de importações e qualidade.
- Ingestão automática de até 5 símbolos por 5 minutos (configurável), sem armar ordens; streaming com máximo de 30 símbolos por defeito.
- Diagnósticos de gaps **candidatos** em sessão regular de NY (não substituem calendário oficial, halts ou corporate actions).
- SSE Broker atualizado para `/v2/events/trades` com cursor `since_id` quando disponível e deteção de perda de eventos.
- UI Markets com intervalos históricos, splits/dividendos, total armazenado, páginas e aviso de histórico parcial.
- Nova API `GET /api/markets/quality?source=alpaca-iex&symbol=AAPL` para auditar ingestões (requer sessão).
- Trabalho testado com fixtures; **sem conexão externa verificada**, sem chaves incluídas e sem envio de ordens.

Ver detalhes em `docs/FASE_A_DADOS_MERCADO.md`.

## Áreas

- **Core:** OHLCV UTC, SMA, volatilidade/momentum, regime trend/range, sinais determinísticos e versões hash.
- **Broker Engine:** Alpaca Broker Sandbox e Trading Paper com endpoints/credenciais independentes. Exclusivamente Alpaca; contas Live recusadas.
- **Execution:** intenções duráveis, IDs únicos, reconciliação, ordens/eventos/fills/posições, kill switch e lease de worker.
- **AI Research:** inferência local isolada, sem ferramentas, vault ou capacidade de executar ordens.
- **OS:** Overview, Markets, Trading Terminal, Orders, Portfolio, Strategies, Backtesting, AI Research, System Monitor, Broker Connections.

## Testes e operação

```bash
npm run check
npm test
npx playwright install chromium
npm run test:e2e
node scripts/benchmark-ollama.mjs # requer Ollama local e backend em execução
```

Os testes de corretoras usam fixtures explícitas só dentro de `tests/`; o backend de produção nunca importa essas fixtures. Testes e benchmarks efetivamente executados estão em `reports/` na entrega. Sem credenciais não é possível comprovar ordens nem streams Demo reais.

Documentação: [auditoria](docs/AUDITORIA_V04.md), [estado e bloqueios](docs/ESTADO_V04.md), [arquitetura/API](docs/TECNICA.md), [operação/publicação](docs/OPERACAO.md), [protocolo de 60 dias](docs/PROTOCOLO_60_DIAS.md), [testes](docs/TESTES.md).

Não é uma declaração de rentabilidade nem uma plataforma Live. A SMA é baseline de infraestrutura. Sem dados, a interface mostra estados vazios. Sem IA, o motor determinístico continua independente.

Nesta versão Alpaca-only: liquidar uma posição ou todas, long/short e frações, cancelar ordens pendentes, reconciliação e proteção contra reenvios. Liquidar exige MANUAL_PAPER e ausência de ordens pendentes nos símbolos a encerrar.