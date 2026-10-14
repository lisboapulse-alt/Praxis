> **PRAXIS v0.3 DEMO_UNRESTRICTED — nota prioritária:** em contas fictícias NÃO impor limites financeiros locais por exposição, perda, número de ordens ou posições; preservar apenas isolamento demo, idempotência, segurança de credenciais, validação técnica de ordens e métricas observacionais. Em caso de contradição, seguir `docs/ALTERACOES_DEMO_V3.md`.

# PRAXIS — Protocolo de 60 dias (forward-testing)

## Fases e métricas

| Dias | Estado | Objetivos |
|---|---|---|
| 1–7 | validação e estabilização | ligações, dados frescos, ordens sandbox minúsculas, reconciliação, watchdog, desarme, restart, Uptime medido |
| 8–30 | baseline determinística congelada | execução automática paper, ledger de custos, benchmark buy-and-hold/flat conforme mercado, incidências, P&L, drawdown |
| 31–45 | ablação Research LLM | comparar análises/recomendações de pesquisa Ollama; IA não altera ordens; fora da amostra; consumo CPU e tempo |
| 46–60 | validação de estratégia candidata congelada | estabilidade em regimes diferentes, falhas, drawdown, consistência pós-custos, qualidade de execução |

## Métricas mínimas com proveniência
- Retorno nominal, P&L realizado/não realizado, equity, despesas explícitas (spread, slippage simulado/observado, comissões aplicáveis e eventuais taxas de dados).
- Máximo drawdown, volatilidade, taxa de ganhos, profit factor, expectancy, turnover, número de sinais/ordens/fills e exposição média.
- Trades bloqueados por RiskGate, ordens rejeitadas, eventos duplicados, staleness, reconciliações divergentes, tempo de indisponibilidade por broker e uptime medido (não inferido).
- Comparação por versão de estratégia e feed; evitar comparar IEX com SIP como se fossem iguais.
- Dias sem trades e mercados fechados são válidos; 24/7 corresponde a sistema a funcionar, não mercado sempre aberto.

## Go/no-go para paper automático
Somente quando estiver tudo verdadeiro: broker sandbox identificado, conta e permissões validadas, feed com timestamp, valores de risco na DB, executor único, kill switch ativo, ensaios de idempotência passados, reconciliação após restart, backups testados, 0 endpoints live, dashboard sem mocks disfarçados, logs sem segredos.

## Custos e falhas
Validar quotas Oracle/Netlify e permissões de Market Data antes de ativar; Always Free não garante instância disponível nem SLA. Alertar sobre custos emergentes; não criar máquinas/volumes fora do Always Free. O LLM local pode ser desativado automaticamente em saturação de CPU/memória. Sistema deve continuar protegido sem IA.

## Relatório diário
Gerar diariamente: versão, brokers online/offline, último heartbeat, número de ordens, equity e drawdown quando medíveis, ordens pendentes, erros críticos, tempo de dados stale, últimas reconciliações, estado do kill switch, estado Ollama e decisões de risco auditáveis. Se não houver dados, usar `indisponível`, nunca zero inventado.
