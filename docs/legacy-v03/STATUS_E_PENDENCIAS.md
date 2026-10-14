# PRAXIS — Estado de execução (13 outubro 2026)

## Implementado e confirmado LOCALMENTE
- Dashboard adaptada do protótipo PRAXIS com paleta TailAdmin original `#465FFF` e modo escuro; não é cópia literal do TailAdmin original.
- Servidor HTTP e autenticador com cookie HttpOnly e sessões revogáveis no SQLite.
- Cofre AES-256-GCM, conexão Alpaca Broker Sandbox e Alpaca Trading Paper (verificação/consulta definida, testes mock).
- SQLite WAL, persistência dos sinais, OMS paper com `client_order_id` idempotente, estado `UNKNOWN` sem retry, reconciliação por client id.
- Perfil DEMO_UNRESTRICTED: sem caps locais de exposição, ordens/dia, drawdown ou posições; conta/ambiente verificados, deduplicação de sinais e autenticador mantidos.
- Estratégia baseline SMA 5/20 versionada, loop de polling a cada 90 s (por defeito) após armamento explícito.
- Chart de equity apenas com snapshots reais; sem dados exibe vazio.
- Preparação da pesquisa Ollama localhost (o modelo NÃO foi descarregado nem testado na cloud).
- `npm test`: 21 testes locais passaram, incluindo HTTP E2E com autenticação e disarm.

## NÃO implementado / NÃO validado
- Acesso e deploy na conta Oracle ou Netlify; DNS/TLS de produção; backup/restauro real na VM.
- Autenticação de credenciais verdadeiras ou quaisquer ordens em contas Alpaca: apenas mocks HTTP e testes locais. Credenciais anteriormente partilhadas foram intencionalmente excluídas.
- Broker Sandbox: campos de assets, contas e ordens base; stream SSE, múltiplos tipos de ordem, lifecycle completo e gestão financeira ainda não implementados.
- cTrader Demo: OAuth, stream e ordens não implementados.
- Market Data: REST IEX de 1 minuto; sem WebSocket, Level 2, SIP ou entitlement verificado.
- Ollama: ligação opcional `/api/research`, mas sem modelo instalado/testado.
- Estratégias históricas PRAXIS originais: nenhum repositório PRAXIS real foi identificado. SMA 5/20 é só baseline de engenharia; não validada como edge de trading.
- Gestão de risco institucional / ledger fiscal, SL/TP reais, broker trade event SSE, alertas externos, replay/backtesting completo e performance OOS não feitos.
- Testes de falha real de rede, restart abrupto, duplicação de workers, limites de execução em mercado ou manutenção 60 dias não realizados.

## P0 antes de armar AUTO_PAPER num deployment externo
1. Integrar repositório PRAXIS verdadeiro, executar security review e dependência estável de SQLite ou PostgreSQL.
2. Rotacionar chaves expostas; configurar vault no servidor, autenticador forte e HTTPS.
3. Criar e proteger a VM, configurar storage persistente e backups/restores, testar kill switch.
4. Validar Alpaca GET /accounts (Broker Sandbox) ou GET /v2/account (Trading Paper), descobrir conta e entitlement de IEX.
5. Validar SSE, reconciliação após crash, relógio de mercado, posições, ordens e consistência de valores.
6. Melhorar observabilidade de ordens pendentes no broker, bid/ask, slippage e custos, e distinguir sinais stale sem impor travões financeiros no modo Demo.
7. Testar manualmente uma ordem mínima Paper via botão e endpoint já implementados, confirmar aceitação/cancelamento e reconciliação REAL com Alpaca antes de ativar auto. O cancelamento pela UI ainda não está implementado.
8. Proteger conta cloud, CORS e proxy, monitorização, backups e eventos; confirmar alinhamento de UTC e mercado fechado.
9. Só então ativar AUTO_PAPER com validação externa contínua.

Não confundir `tests passed` com `trading running`. Nenhuma ordem real/virtual foi enviada nesta execução.
