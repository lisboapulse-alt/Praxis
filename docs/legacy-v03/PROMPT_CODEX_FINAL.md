**ATUALIZAÇÃO PRIORITÁRIA DO UTILIZADOR — v0.3**
O modo Demo não deve ter tetos locais de quantidade de ordens, exposição, perda diária, drawdown, número de posições ou venda a descoberto. Ver `ALTERACOES_DEMO_V3.md`. Não reintroduzir esses limites apenas por prudência: recolher e apresentar métricas sem bloquear as experiências. Manter isolamento PAPER, privacidade de chaves, idempotência e rastreabilidade. Em caso de conflito com as instruções abaixo, prevalece esta atualização.

# PROMPT FINAL CODEX — continuar a base operacional existente

Quero que utilizes todo o conteúdo deste ZIP `PRAXIS_OS_PRE_CODEX_V2` como **implementação local verificada**, sem sobrepor cegamente o repositório PRAXIS real. Primeiro localiza o repositório original e cria inventário e diff. Lê `README.md`, `docs/STATUS_E_PENDENCIAS.md`, `docs/DEPLOY.md` e o prompt mestre de 60 dias em `docs/02_CODEX_MASTER_PROMPT.md`.

O projeto tem 17 testes locais (Node 22) que passaram. Consolida-o com o PRAXIS original e corrige urgentemente os P0:
1. Validação real das credenciais **renovadas** Alpaca Broker Sandbox e Trading Paper, com as contas e seus estados autorizados.
2. Completa o trading manual fictício e ordens de cancelamento/substituição, streams SSE e reconciliação, idempotência após crash real, single-worker lock, métricas observacionais de risco intradiário e eventos de fills com dedupe.
3. Verifica todos os parâmetros da Broker API, Trading Paper e dados IEX atuais antes de ativar trading, sem confundir ambientes ou entitlement.
4. Integra cTrader Demo via OAuth e symbol metadata em segundo estágio, sem permitir live.
5. Provisiona VM Linux grátis (com aprovação de custos), Node, SSL, Caddy/systemd, backups e restore; integra a interface TailAdmin blue original no Netlify por proxy ou serve-a na mesma VM, escolha menos complexa primeiro.
6. Instala Ollama pela documentação oficial, descarrega **diretamente na VM** `qwen3:1.7b`, fixa versão/digest e testa classificador. O LLM não toca em ordens.
7. Substitui mecanismos prototípicos e experimentais por variantes robustas para 60 dias: node:sqlite em Node 22 em estado experimental, configuração NTP, estados fail-closed, SL/TP e alertas, dados atrasados, posição parcial e preços executados, horários, ledger financeiro, monitorização e 60 dias com baseline congelada.
8. Executa testes E2E de falhas HTTP e SSE, replay, backtest sem look-ahead, crash/restart, recuperação de credenciais, streaming, reconciliação, UI browser e live-sandbox com IDs mascarados. Corrige os erros que encontrares.
9. Não implantes estratégias com edge não validada como se fossem rentáveis; a SMA 5/20 é só um teste de engenharia, não recomendação financeira.

**Nunca** enviar ordens reais; **não** reutilizar a chave pública/secret anteriormente colados no chat. Não colocar secrets em ficheiros do repo ou neste chat. Trading AUTO_PAPER só após os gates técnicos anteriores e autorização explícita apenas para simulação. Não afirmar que está a negociar até confirmar uma ordem fictícia via API, event/fill e reconciliação real na conta Sandbox.

Entrega URL reais verificadas (só depois de deploy), estado de cada serviço, cobertura de testes, últimos erros, operação PAPER ou bloqueios e checklist para 60 dias.
