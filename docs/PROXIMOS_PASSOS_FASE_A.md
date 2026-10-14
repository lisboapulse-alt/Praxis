# Fase A — backlog de verificação no repositório

## P0 — segurança e ligação externa
- [ ] Criar repositório privado e confirmar a branch `main`.
- [ ] Passar CI no GitHub Actions.
- [ ] Configurar credenciais **novas** exclusivamente via backend autenticado; as credenciais anteriormente partilhadas numa conversa devem ser rodadas.
- [ ] Testar GET de leitura na Alpaca Broker Sandbox e/ou Trading Paper, registar URL base, account IDs mascarados e permissões, sem expor segredos.
- [ ] Validar endpoints Broker SSE v2 e atividades com conta demo autorizada.

## P1 — dados de mercado
- [ ] Executar backfill paginado de 2–3 instrumentos com `next_page_token`.
- [ ] Comparar origem IEX versus outras fontes disponíveis e identificar limitações do feed.
- [ ] Validar reconciliador de candles em dias sem sessão, splits, dividendos e timezones.
- [ ] Testar reconexão de WebSocket e persistência de última mensagem/cursor.
- [ ] Testar recuperação após reinício a meio de uma importação.

## P2 — operação
- [ ] Publicar dashboard TailAdmin mantendo cores originais.
- [ ] Subir backend persistente na VM, com backups de SQLite, healthcheck e logs.
- [ ] Testar o sistema apenas em modo desarmado; fazer ordens fictícias após validação explícita da conta e dos estados.
- [ ] Instalar e medir Ollama local (opcional e isolado da execução).

## Nota
O GitHub é o repositório do código, não um host de trading 24/7. O serviço cloud, credenciais e recursos de infraestruturas ainda exigem configuração separada.
