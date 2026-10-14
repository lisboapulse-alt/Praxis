# PRAXIS v0.4.2 Fase A — Continuar com Codex

1. Abrir este projeto como **continuação** da v0.4.1, não reescrever do zero.
2. Usar Node.js **24+**; executar `npm ci`, `npm run check`, `npm test`, `npm run build` e testes browser existentes.
3. Ler `docs/FASE_A_DADOS_MERCADO.md` e rever os novos módulos `src/market-quality.mjs`, `src/market-poller.mjs` e `scripts/backfill-market.mjs`.
4. Fazer testes live **de leitura** com credenciais **Paper/Sandbox renovadas guardadas na dashboard**, não com chaves antigas em prompts ou arquivos.
5. Validar com a Alpaca `GET /v2/stocks/{symbol}/bars` com `page_token`, `feed`, `adjustment`, Broker Sandbox Basic/OAuth e stream em `stream.data.sandbox.alpaca.markets`. Confirmar cotação/horário e limites específicos da conta.
6. Confirmar `/v2/events/trades` Broker SSE e `since_id` ULID com eventos reais no Sandbox; validar `GET /v1/accounts/activities` e paginação de FILL. Reconciliação continua obrigatória.
7. Fazer backfill de 1Day em 2–5 ativos e 1Min numa semana; comparar contagens entre API/DB, validar `complete`, fonte/ajustes, duplicados e gaps candidatos.
8. Fazer polling sem AUTO armado; medir taxas de erro, latência e utilização da quota, incluindo fecho/abertura dos mercados e fim de semana.
9. Avaliar calendário oficial de sessões/feriados/halts e corporate actions para classificar lacunas confirmadas (atualmente apenas candidatos), sem quebrar a baseline.
10. Preparar deploy. Não ativar LIVE nem criar despesas cloud não aprovadas. O motor deve continuar desarmado até validação do utilizador.

## Estado preciso

- **Concluído localmente:** contrato API e código fonte, autenticação dual Broker, paginação, história em blocos, proveniência, qualidade básica, polling, alterações na dashboard, 56 testes locais aprovados sem rede.
- **Pendente por infraestrutura:** Node 24 + `npm ci`, testes WebSocket/HTTP/Playwright, Broker e Market Data autenticados, VM persistente e rede para a Alpaca.
- **Fora de âmbito imediato:** calendários oficiais completos, SIP contratado, Level 2, feeds pagos, ativação de ordens.

## Segurança

Não colocar secrets em commits, ZIP, logs, URLs, prints ou testes. Só variáveis privadas/cofre. O modo operacional permanece exclusivamente Demo/Paper.
