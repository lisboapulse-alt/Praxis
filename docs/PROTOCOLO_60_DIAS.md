# Protocolo de investigação · 60 dias

O período começa no primeiro armamento AUTO_PAPER bem-sucedido; início/fim ficam persistidos. Ao atingir 60 dias, o worker desarma novas ordens. A disponibilidade do host é requisito externo: o ambiente de implementação não constitui operação Oracle permanente.

| Dias | Protocolo | Critério verificável |
|---|---|---|
| 1–7 | Validar contas Demo, Market Data IEX, horários, ordens/partial fills/cancelamentos/rejeições, clock UTC, timeout e restart | IDs broker reais; reconciliação consistente; backups restaurados; nenhuma chamada Live |
| 8–30 | Baseline SMA determinística com versão congelada e quantidade definida pelo investigador | Cada decisão ligada a versão, candles, features, intenção, execução ou motivo de não executar |
| 31–45 | Comparação de pesquisa com/sem contexto Ollama | Conjunto fixo de notícias, outputs armazenados, rótulos de avaliação humana; qualquer feature candidata determinística é previamente versionada/backtestada |
| 46–60 | Validação fora da amostra | API recusa alteração de parâmetros da estratégia durante esta fase; sem otimização sobre resultados fora da amostra |

O LLM não altera parâmetros nem envia ordens. A comparação com/sem Ollama **não** é uma funcionalidade automática de seleção de estratégias: executar um protocolo de ablação explícito e decidir versões antes do congelamento. Não há base histórica de notícias fornecida nem rentabilidade medida nesta entrega.

## Registos

Preservar DB, vault key e commits. Registar todos os sinais/decisões, versões, candles e hashes; intenções, estados, IDs, fills, posições e snapshots; P&L de equity, drawdown, retornos diários, Profit Factor quando houver ledger validado, Sharpe/Sortino e periodicidade; latência POST, referência de preço, desvio de fills; falhas/alertas, heartbeat, RAM, estado dos streams e outputs de pesquisa.

Relatórios devem distinguir `BACKTEST`, `REPLAY`, `PAPER_FORWARD` e `RESEARCH`. Ausência de observações significa indisponível/null, não zero estatístico. Dias sem operação e mercado fechado não são incidentes por si próprios. IEX não é SIP/consolidado/Level 2.

## Gate antes de AUTO

Credenciais renovadas introduzidas na UI, conta Paper ativa, permissões e relógio testados, candles recentes suficientes, reconciliação sem intenções antigas ambíguas, worker único, backup/restore testado, host/disco/restart/HTTPS prontos. A ação de armar AUTO na dashboard é a autorização explícita para operações fictícias. Nenhuma conta Live é aceite.

## Relatórios

Exportar daily report com `node --env-file=.env scripts/daily-report.mjs` (ou EnvironmentFile do serviço). Inclui somente dados guardados, com unidade/limites estatísticos descritos. O relatório final de 60 dias depende do período efetivamente executado; não é criado artificialmente nesta sessão.
