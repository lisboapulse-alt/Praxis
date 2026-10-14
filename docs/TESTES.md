# Evidências de validação

Os relatórios incluem timestamps e outputs efetivamente obtidos nesta sessão. Não são prova de uma conta Demo real nem de rentabilidade.

## História verificada

O utilizador entra na dashboard, autentica, introduz uma ligação Paper, descobre/seleciona conta, arma o modo fictício, submete uma ordem única, recebe estado persistido, acompanha/cancela, carrega OHLCV, executa backtest/replay e consulta pesquisa/monitor.

| Fronteira | Evidência |
|---|---|
| UI e browser | Playwright em Chromium real, sem erros JS: login, conexão, disable/enable, ordem/cancelamento, tabelas/filtros, candles, backtest/replay, research, logs, dark/mobile, logout |
| Client → API | Testes fazem HTTP real ao backend; sessão/cookie, origem, métodos e payloads validados |
| API → SQLite | Credenciais armazenadas cifradas; intenções/versões/barras/fills persistidos; SQLite WAL/backup/restore e restart exercitados |
| API → broker | Contratos testados com fixtures exclusivamente em `tests/`; WSS IEX e trade_updates com frames simulados |
| Broker → journal/UI | Dedupe, estados terminais monotónicos, cancelamento, rejeição e eventos persistidos; respostas renderizadas no browser |
| Backend → Ollama | Três inferências reais locais, modelo oficial, tempo/tokens/RAM medidos, outputs preservados |
| Ollama indisponível | Serviço parado durante teste: backend e engine 200, research 503, supervisor reinicia; env do processo sem vault/password/sessão |
| Host → recuperação | SIGKILL durante POST, lease real 30s expirada, reinício/reconciliação sem POST duplicado |

## Ficheiros

- `reports/node-tests.tap`: suite unitária, contratos, HTTP, auth, timeout, persistência, lease, restart e crash.
- `reports/playwright.json` e `browser-tests.log`: execução browser completa.
- `reports/build.log` / `syntax.log`: compilação TailAdmin e sintaxe de módulos.
- `reports/npm-audit-production.json`: resultado real de audit das dependências de produção; não substitui revisão de segurança.
- `reports/ollama-benchmark.json`: três resultados **reais**, latência, tokens/s, RSS conjunto e health durante geração.
- `reports/ollama-failure-isolation.json`: indisponibilidade/restart/isolation efetivos.
- `reports/dashboard-*.png`: capturas do backend real **sem contas ligadas**, não capturas de fixtures de broker.
- `reports/validation-summary.json`: contagens e resumo mecanicamente extraído dos outputs.

## Testes não executados

Contas/ordens/fills reais Alpaca Sandbox/Trading Paper; entitlements SIP/Level 2; streams reais autenticados; publicação Netlify/Oracle/HTTPS; instalação root/systemd; alertas externos/off-host backup; experiência de 60 dias e resultados fora da amostra com mercado real. Faltam acessos/credenciais/tempo de experiência correspondentes.

Modelos económicos não foram aprovados como factualmente fiáveis. Ver `QUALIDADE_OLLAMA.md`: identificados erros reais; não se atribui nota de qualidade artificial.
