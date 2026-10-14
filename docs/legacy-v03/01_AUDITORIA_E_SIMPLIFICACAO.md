# PRAXIS — Auditoria técnica do protótipo disponível
Data: 2026-10-13 | Escopo: ficheiros `reference_app/` neste pacote, NÃO o motor PRAXIS original não identificado.

## Evidência efetivamente verificada
- `npm run check` executado localmente com Node 22: 9 testes passam e `build` confirma existência de quatro ficheiros. **Não** há testes end-to-end de broker real, deploy Netlify, base de dados, streams ou ordens.
- `src/alpaca.mjs`: `verifyBroker()` lê ativos em `/v1/assets` (Broker Sandbox) ou uma conta Trading Paper; `readTradingPaper()` consulta conta, posições e últimas 20 ordens.
- `netlify/functions/praxis-api.mjs`: sessão baseada em palavra-passe, vault cifrado em Netlify Blobs e endpoints de leitura; não existem POST de ordens.
- `public/app.js`: curva de equity criada matematicamente a partir de senos e cossenos; está rotulada como ilustrativa, mas deverá desaparecer de qualquer painel apresentado como operacional.
- `public/index.html`: apresenta `Risk Guard ON` por bloqueio de execução, não porque exista um motor de avaliação de risco e recuperação de falhas.
- `cTrader Demo`: explicitamente pendente no painel, sem OAuth/adapter.
- Sem store transacional de `order_intent`, `client_order_id`, fills, sinais, eventos, retentativas, ledger, leader election ou reconciliação.

## Problemas por severidade

### Bloqueadores antes de negociação sandbox
1. **Ausência de OMS e Risk Engine**: o frontend read-only NÃO é plataforma de negociação. Criar ledger durável e fail-closed antes de ativar.
2. **Inexistência de worker persistente**: Netlify Functions não são executor 24/7 nem host de WebSockets duradouros.
3. **Falsa confiança na validação de credenciais**: GET /assets comprova leitura, não autorização para negociar, existência de account_id, buying power ou Market Data.
4. **Sem reconciliação/idempotência**: timeout depois de enviar POST pode duplicar ordens se houver retry cego.
5. **Chaves anteriormente expostas na conversa**: não reutilizar nos commits. Rotacionar e introduzir de forma segura no dashboard/vault privado. Nunca guardar dados privados no modelo LLM.

### Problemas funcionais / UX
6. **Estados simulados**: equity chart ilustrativo, Risk Guard ON, badges ONLINE baseados na configuração; apresentar `não ligado / por confirmar` até dados e heartbeat verdadeiros.
7. **Dupla gestão de estado e credenciais**: o protótipo guarda segredos em Netlify Blobs, mas o futuro worker precisaria de outro canal para consumi-los. Migrar para vault cifrado dentro do backend, com PostgreSQL partilhado.
8. **Autenticação rudimentar**: falta proteção adicional (rate limit, MFA/SSO, revogação de sessões, logs de segurança e isolamento por utilizador se necessário).
9. **Integração Alpaca mista**: distinguir totalmente Broker Sandbox (HTTP Basic / account_id específico) de Trading API Paper (headers de key e conta própria); distinguir Market Data (feed, permissões e OAuth quando exigido).
10. **Ausência de entitlements de dados**: nunca rotular feed como real-time sem evidência de cobertura, timestamp, latência e subscrição.

### Complexidade desnecessária a não introduzir na v1
- Retirar `EnergeticAI`: Ollama substitui-o para investigação textual; não dois módulos equivalentes na primeira iteração.
- Sem Kubernetes, Kafka, Redis, Spark, feature store distribuída ou arquitetura multiagente.
- Sem cinco estratégias otimizadas simultaneamente: apenas baseline fixo e 1–2 candidatas com versionamento.
- Sem trading live, margem, shorts, opções, alavancagem, HFT, DOM/Level 2 presumido ou otimização automática em produção.
- Sem dependência de LLM no caminho síncrono `strategy -> risk -> order`.
- Não reescrever o PRAXIS core original sem o inspecionar; adaptar por interfaces e preservar o código que já funciona.

## Princípio de arquitetura simplificada
UM produto PRAXIS, três módulos: `Core` (determinístico + OMS + Risk), `Research` (Ollama opcional e assíncrono), `OS` (TailAdmin original e control plane). Um único PostgreSQL, um único backend com worker e API administrativos, um único Ollama local, um único deploy frontend Netlify.

## Plano corretivo
1. Inspeção real do repositório PRAXIS e inventário dos módulos, fluxos e dependências atuais.
2. Proteger chaves; separar demo de real por allowlist server-side.
3. Implementar OMS + Risk Engine + reconciliação antes de enviar ordens.
4. Implementar Alpaca Sandbox manual, provar abertura/fecho/cancelamento de ordens fictícias.
5. Implementar feed de mercado com validade temporal.
6. Implementar auto-paper determinístico e kill switch.
7. Integrar cTrader Demo sem atrasar o lançamento Alpaca.
8. Instalar Ollama na VM, descarregar modelo e fazer relatórios de pesquisa assíncronos.
9. Deploy, testes de failover, ciclo experimental 60 dias.
