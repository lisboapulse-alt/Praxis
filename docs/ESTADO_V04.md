# PRAXIS v0.4.1 — apenas Alpaca

Decisão do utilizador: usar exclusivamente Alpaca para simular trades e gerir/liquidar posições. cTrader, OAuth e adaptador correspondente removidos do código, interface e testes atuais. Documentos em legacy-v03 e auditoria histórica preservam o contexto anterior.

Operacional localmente:

- Alpaca Trading Paper como ligação principal; Alpaca Broker Sandbox independente e opcional. Endpoints Live continuam proibidos.
- Conta, saldos, buying power, posições, ordens, cancelamentos/substituições e reconciliação.
- Liquidação individual ou de todas as posições, incluindo long, short e frações. Jobs/intenções persistentes com requestId único; timeouts não provocam reenvios.
- Cancelamento de ordens pendentes da conta; confirmação pela reconciliação.
- AUTO SMA versionada para Trading Paper; antes de liquidar, suspender AUTO e armar MANUAL_PAPER. Ordens pendentes nos símbolos alvo devem ser canceladas/confirmadas para evitar reabertura de posições.
- Dashboard TailAdmin, backtesting/replay, SQLite WAL, autenticação/cofre, Ollama local e scripts de instalação/backup/restore.

Bloqueios externos:

- Credenciais Alpaca renovadas, introduzidas na dashboard, para validar ordens/fills/streams Demo reais.
- Confirmação separada de Market Data IEX; SIP e Level 2 não presumidos.
- Acesso à VM Oracle, domínio HTTPS e Netlify para publicação e operação 24/7.
- Nenhuma conta está ligada, o motor está desarmado e os 60 dias ainda não começaram.

Limites analíticos: P&L realizado líquido/Profit Factor forward ainda exigem ledger completo de custos/round trips; cashflows não ajustados. Ollama tem erros factuais observados e serve apenas investigação com revisão humana. Modelos do PRAXIS original não foram fornecidos.
