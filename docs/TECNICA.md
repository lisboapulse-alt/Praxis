# Arquitetura e contrato técnico

Node 24 LTS, módulos ES, um processo backend HTTP + worker. SQLite WAL, synchronous FULL, foreign keys, busy_timeout, transações `BEGIN IMMEDIATE`, backups via API SQLite. `src/core.mjs` não tem rede nem segredos; `research.mjs` não importa adaptadores/engine/vault.

| Área | Ficheiros | Responsabilidade |
|---|---|---|
| PRAXIS Core | `core.mjs` | OHLCV UTC, SMA/features/regime, parâmetros/versionamento, replay/backtest/métricas |
| Broker Engine | `adapters.mjs`, `streams.mjs` | REST Alpaca, IEX WS, trade_updates Paper e SSE Broker |
| Execution Engine | `oms.mjs`, `engine.mjs`, `storage.mjs`, `db.mjs` | Intenções, geração de execução, reconciliação, worker/lease, persistência |
| AI Research | `research.mjs` | Qwen3 local, tarefas textuais, busy gate, timeout, histórico de resultados |
| PRAXIS OS | `server.mjs`, `api-extra.mjs`, `public/*` | Autenticação, API administrativa, dashboard TailAdmin |

## Persistência

`connections`: AES-256-GCM com nonce único e AAD. Vault key externa à DB, nunca devolvida pela API. `settings`: estado de execução/experiência; `sessions`: hashes de tokens revogáveis; `order_actions`: alterações idempotentes, com timeout ambíguo sem retry; `order_intents`: IDs determinísticos e sinal único por conta/broker; `broker_orders`, `order_events`, `fills`, `position_snapshots`, `equity_snapshots`: estado observado e journal; `market_bars` e `market_ticks`: fonte/símbolo/UTC/unidades; `strategy_versions`, `signals`: parâmetros/features/hash de dados; `backtest_runs`, `research_runs`: resultados separados; `heartbeats`, `alerts`, `audit`, `worker_lock`: operação.

A DB deve estar num disco persistente local, um único host. Não colocar SQLite WAL em NFS partilhado. A migração futura para PostgreSQL exige substituir `DatabaseSync`, pragmas e o mecanismo de lease; o esquema é explícito, mas ainda não existe adaptador Postgres.

## Autenticação e origens

Password administrativa aleatória de 24+ caracteres em env privado; comparação constante; rate limit de login por IP direto. Sessão opaca de 256 bits com hash SQLite, duração 8h, cookie HttpOnly/SameSite Strict, Secure em produção. Todas as APIs, salvo health/login, exigem sessão. Mutações exigem `X-Praxis-Action: 1` e origem permitida. Netlify usa proxy same-origin `/api/*`; nunca API keys no browser/storage. O browser recebe segredos apenas quando o utilizador os escreve para envio; depois do sucesso os campos são apagados. Modelos/notícias nunca recebem o vault.

Não é multitenant nem SSO/MFA. O administrador tem controlo integral da conta Paper. O URL de broker é fixo, nunca aceita URL fornecido pelo browser. Credenciais Broker Basic e Trading APCA permanecem separadas. Market Data usa exclusivamente credenciais Trading Paper em `data.alpaca.markets`, IEX declarado, SIP/Level 2 não verificados.

## Execução

1. Conta e parâmetros técnicos validados; não existem tetos locais de ordens, posições, perdas, exposição ou tamanho financeiro.
2. Revalidar geração/mode/kill após awaits. Persistir intenção SUBMITTING e evento antes de POST.
3. Guard de despacho verifica estado imediatamente antes do envio. Depois de a rede aceitar um pedido, o kill switch não pode retirar essa ordem; usar cancelamento.
4. Erros ambíguos ficam UNKNOWN, sem retry. 404 numa consulta não demonstra não entrega. Novas intenções independentes continuam possíveis em DEMO; a baseline long/flat evita uma segunda entrada do mesmo símbolo/versão enquanto a sua entrada está pendente.
5. Reconciliação atualiza ordens não terminais, histórico/fills/posições. IDs únicos impedem duplicação. Backups incluem transações WAL confirmadas.
6. Restart pausa e reconcilia antes de retomar o modo anteriormente autorizado. Kill explícito limpa autorização de retoma. Lease 30s, renovada 10s; reinício após crash espera expiração.

AUTO inicial: Alpaca Trading Paper, candles 1Min completos, market clock aberto, dados até 5 minutos, SMA parametrizada, quantidade fixa experimental, long/flat. Sem instruções LLM no caminho das ordens. AUTO Broker Sandbox ainda não é disponibilizado.

## API principal (autenticada)

| Métodos/rotas | Ação |
|---|---|
| POST `/api/auth/login`, `/api/auth/logout`; GET `/api/auth/session` | Sessão/revogação |
| GET `/api/brokers` | Estado configurado e último teste, sem segredos |
| POST `/api/brokers/{type}/activate`, `/verify`, `/disable`, `/enable`; GET `/accounts`; DELETE `/{type}` | Alpaca guardar/testar/descobrir/remover |
| GET `/api/engine`; POST `/arm`, `/disarm`, `/reconcile`, `/cycle`, `/symbol` | Controlo do motor |
| POST `/api/orders/manual`; GET `/api/orders`; POST `/api/orders/{id}/cancel`, `/replace` | Intenções e alterações de ordens Demo/Paper |
| GET `/api/overview`, `/equity`, `/portfolio` | Dados observados e snapshots/execuções |
| GET `/api/markets/data`, `/history`; POST `/subscribe`; GET/POST `/api/watchlist` | OHLCV, trades/quotes/spread, cache e streaming |
| GET `/api/strategies`; POST `/api/strategies/parameters` | Versões, sinais e parâmetros |
| GET/POST `/api/backtests`; POST `/api/replay` | Simulações, comparações e replay sem ordens |
| POST `/api/research`; GET `/api/research/health`, `/runs` | Ollama local e histórico |
| GET `/api/system`, `/audit` | Recursos, heartbeat, streams, alertas e decisões |

Os sufixos de engine referem-se a `/api/engine/...`; os de broker a `/api/brokers/{type}/...`. UI usa cancelamento; substituição de ordens está disponível na API e ainda não tem formulário dedicado.

## Dados e estatística

OHLC obrigatório, preços positivos, volume opcional, timestamps UTC únicos/ordenados; valores inválidos recusados. Volume Alpaca em ações;

Backtest: candle fechado → ordem na abertura seguinte; long/flat, custos e slippage bps explícitos, capital inicial simulado explícito, sem modelo de capacidade/impacto/financiamento/dividendos. Não fecha artificialmente uma posição no último candle; equity final marca posição aberta. Sharpe/Sortino usam periodicidade especificada; Profit Factor inclui somente trades fechados. Replay preserva decisões de prefixos históricos.

Forward: snapshots diários para Sharpe/Sortino; retornos não ajustados a cashflows externos. P&L de equity/drawdown não são P&L líquido fiscal. Profit Factor realizado permanece null sem ledger completo de custos/round trips. `reference_price`, `data_time`, `latency_ms` e fills permitem observar desvio face ao fecho do sinal; esse desvio não é spread nem causalmente atribuível apenas a slippage.

Substituição de ordens exige requestId; alterações

`POST /api/positions/liquidate`: body `{requestId, symbol?}`, uma posição ou todas. Requer MANUAL_PAPER, conta validada e nenhum pedido pendente nos símbolos alvo. Long é encerrado por sell, short por buy, quantidades fracionadas preservadas. Intenções únicas e jobs persistentes evitam reenvios; UNKNOWN exige reconciliação. `POST /api/orders/cancel-all` pede cancelamentos na conta selecionada e reporta os que continuam por confirmar.
