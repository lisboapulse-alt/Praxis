> **PRAXIS v0.3 DEMO_UNRESTRICTED — nota prioritária:** em contas fictícias NÃO impor limites financeiros locais por exposição, perda, número de ordens ou posições; preservar apenas isolamento demo, idempotência, segurança de credenciais, validação técnica de ordens e métricas observacionais. Em caso de contradição, seguir `docs/ALTERACOES_DEMO_V3.md`.

# PROMPT MESTRE — PRAXIS OS 60 DIAS | Alpaca Broker Sandbox + cTrader Demo + Ollama local

Tu és o engenheiro principal responsável por implementar e colocar a funcionar o PRAXIS **com ordens exclusivamente fictícias (paper/sandbox)**. Tens autorização do dono para realizar operações simuladas, mas **NUNCA** operações live, depósitos, transferências reais, alavancagem real nem faturação de serviços sem autorização. O objetivo é uma implementação elegante, simples, auditável, preparada para 60 dias de funcionamento na cloud com o computador do utilizador desligado.

## A. Contexto e source of truth
- Repositório PRAXIS real tem prioridade. Inspeciona toda a estrutura, branches, código atual, pipelines, configuração de deploy e documentação. Não assumes que `reference_app/` é o core PRAXIS; é só um protótipo anterior de TailAdmin/Netlify/alpaca de consulta.
- Lê primeiro `01_AUDITORIA_E_SIMPLIFICACAO.md` e `03_CRITERIOS_60_DIAS.md`; cria `docs/PRAXIS_IMPLEMENTATION_INVENTORY.md` distinguindo **existente**, **mock**, **incompleto**, **corrigido** e **validado live sandbox**.
- Preserva implementações válidas e os testes existentes. Evita reescrever a aplicação ou descaracterizar estratégias pré-existentes.
- Trabalha por commits pequenos, testes contínuos e pull requests; não declares conclusão quando apenas implementaste mocks. Em caso de acesso externo insuficiente, implementa e testa localmente, identifica o passo exato de ligação à conta, sem inventar sucesso.

## B. Arquitetura limpa: modular monolith (não microserviços)

Componentes:
1. **PRAXIS OS (Netlify)** — UI TailAdmin cores ORIGINAIS: `#465FFF`, `#3641F5`, `#FFFFFF`, `#F9FAFB`, `#101828`; fonte Outfit, cartões, tabelas densas mas legíveis, dark mode, mobile e acessibilidade. Zero vermelho da Lisboa Pulse. Evita dashboards com informação fictícia ou efeitos excessivos.
2. **PRAXIS Backend (VM persistente, Linux ARM64 preferencialmente Oracle Always Free)** — API autenticada + worker: dados, calendário, estratégias, regime, risco, OMS, streams e reconciliação. Usa linguagem/stack existente se adequado; caso contrário Node.js 22 + TypeScript para serviço API/OMS e adaptadores. Uma só base PostgreSQL (migrações transacionais, backups, retenção). Docker Compose/systemd com auto-restart, logging e healthchecks.
3. **Ollama (mesma VM, processo separado, ligado APENAS a `127.0.0.1:11434`)** — pesquisa de contexto e relatórios. O worker de ordens NUNCA espera pelo LLM, nem o LLM tem token de corretora.

Não instalar Kubernetes, Redis, Kafka, frameworks de agentes, multi-model orchestration ou reimplementações duplicadas sem necessidade comprovada. Se uma VM gratuita não tiver capacidade, deixar feature flag de IA OFF e manter o trading determinístico operacional. Respeitar limites e quotas da Oracle, verificar memória, CPU, disco e capacidade disponível. Netlify não hospeda WebSockets persistentes nem Ollama.

## C. Abordagem do modelo Ollama — Codex descarrega e instala

1. Na VM Linux, deteta `uname -m` e compatibilidade `aarch64/arm64`, memória real e espaço livre.
2. Instala uma versão estável e verificada de Ollama pelos métodos oficiais (`https://docs.ollama.com/linux` / instalador oficial ou release ARM64) e configura systemd. Não instales Ollama em Netlify nem incluas os pesos no Git/ZIP.
3. Faz **download na própria VM** executando `ollama pull qwen3:1.7b`. A página oficial indica ~1,4 GB quantizados, não incluindo cache/contexto/overheads. Regista o digest do modelo e a versão Ollama nos metadados de experiências. Aplica limites de CPU/RAM e concorrência 1.
4. Valida `GET http://127.0.0.1:11434/api/tags` e `POST /api/chat` com resposta real e verifica os timeouts; protege API local e bloqueia a porta 11434 no firewall público.
5. Implementa `ResearchLLMAdapter` com timeout, fila assíncrona de baixa prioridade, validação de JSON no backend, sanitização de entradas, versionamento de prompts e armazenamento de resumos. Permite desligar Ollama em caso de saturação sem parar o trading.
6. Usos permitidos: sumarização económica, classificação temática, explicação pós-sinal, síntese de relatórios e sugestões de hipóteses para backtests. Nenhuma execução de ferramentas, SQL administrativo, acesso a vault, modificações de política de risco, mudanças automáticas de estratégia ou geração direta de ordens. Tratar conteúdo de notícias como não fiável (prompt injection).
7. Se 1.7B não atingir qualidade suficiente, disponibilizar benchmark configurável com Gemma 3 1B; não descarregar modelos maiores sem medir recursos e obter decisão do utilizador.

## D. Broker neutral + Alpaca

Criar contrato `BrokerAdapter` com métodos `capabilities`, `accounts`, `getAccount`, `assets`, `marketClock`, `orders`, `getOrder`, `submitOrder`, `replaceOrder`, `cancelOrder`, `positions`, `portfolioHistory`, `streamOrderEvents` (apenas conforme suporte real da API), e `MarketDataAdapter` separado: `historicalBars`, `quotes`, `trades`, `subscribe`, `feedEntitlements`, `feedFreshness`. Suportar estado `unsupported` com razão; NUNCA simular recursos inexistentes.

**Alpaca Broker Sandbox (principal)**:
- Host fixo `https://broker-api.sandbox.alpaca.markets`; autenticação Basic de `API_KEY:API_SECRET` pela API Broker, **não** confundir com a Trading API Paper. Descobrir contas de teste, selecionar `account_id`, capacidades/ativo negociável e conta apta. Se não houver conta de teste com saldo, expor o passo de criação/financiamento fictício necessário; nunca usar conta live.
- Implementar consultas de contas, saldos, activos, ordens e posições com paginação e tratamento de erros; submit apenas após `RiskGate`, com `client_order_id` idempotente e `account_id` corretamente mapeado. Testar `POST /v1/trading/accounts/{account_id}/orders` com ordens fictícias mínimas e autorizadas após concluir gates.
- SSE de eventos `/v2/events/trades`, com cursor persistido e REST de reconciliação; tratar fills parciais, rejeições, cancelamentos, duplicados e eventos fora de ordem.

**Alpaca Trading API Paper (secundária)**:
- `https://paper-api.alpaca.markets`, autenticação `APCA-API-KEY-ID` e `APCA-API-SECRET-KEY`, chave própria da conta Paper. Usar apenas se estiver configurada; não bloquear o adaptador Broker Sandbox pela sua ausência.

**Market Data**:
- O Broker e a Market Data podem exigir fluxos de autenticação DIFERENTES, incluindo token OAuth `client_credentials`, por isso descobrir a modalidade específica e os entitlements antes de assumir que Basic basta; gerir token e refresh seguros.
- Exibir proveniência (`IEX`, `SIP delayed`, `SIP real-time`, etc.), timestamps em UTC, staleness, calendário de sessão e permissões. Não inventar Level 2, SIP, dados de cripto ou ações em extended hours sem confirmação. Recusar ordens quando o dado estiver stale.

**cTrader Demo (segundo broker)**:
- Aplicação Open API, OAuth2 com consentimento, tokens de acesso/refresh, seleção de conta demo por `ctidTraderAccountId`; escolher JSON/Protobuf conforme stack; `ProtoOAApplicationAuthReq` e `ProtoOAAccountAuthReq` onde necessário.
- Nunca autorizar contas reais, mesmo que a aplicação tenha acesso a elas. Mapear símbolos, lote, pip, volume e limites mínimos segundo a metadata do broker cTrader; não reutilizar regras de ações.
- Contrato e testes equivalentes aos do Alpaca, sem atrasar o início de testes do Alpaca Sandbox.

## E. Núcleo determinístico, Risco e OMS

Fluxo: `MarketData -> Features -> Regime -> Strategy(versionada) -> Signal -> RiskGate -> order_intent durable -> BrokerAdapter -> execution events -> reconcile -> portfolio ledger -> UI`.

- Sem IA dentro deste fluxo. Usar Decimal/precisão financeira apropriada, relógio UTC, fuso de sessão negociável e IDs estáveis.
- Esquema PostgreSQL mínimo: `broker_connections`, `broker_accounts`, `instruments`, `market_bars`, `market_feed_state`, `strategies`, `strategy_versions`, `signals`, `risk_decisions`, `order_intents`, `broker_orders`, `order_events`, `fills`, `positions_snapshots`, `equity_snapshots`, `model_runs`, `system_heartbeats`, `audit_log`.
- `client_order_id` persistido em transação antes do POST; lock por conta/estratégia; timeout HTTP = resultado UNKNOWN, consultar a corretora por client_order_id/ordem antes de qualquer retry. Unicidade por ID externo e dedupe de eventos, cursor de SSE persistido, reconciliação ao reiniciar e periódica.
- **RiskGate fail-closed**: sem conta aprovada, sem conta demo, sem dados frescos, sem disponibilidade de mercado, sem poder de compra, sem DB, sem estado coerente ou com limite de perdas atingido => ZERO novas ordens.
- Default inicial conservador (CONFIGURÁVEL, PARA PAPER SOMENTE): long only; sem alavancagem, margem, shorts, opções ou ordens fora da sessão regular; max 2% do equity de valor nocional por nova ordem; max 10% exposição total; max 3 posições; max 5 ordens/dia; perda diária máxima 1% do equity inicial do dia; queda global da equity de 3% => bloquear novas ordens e exigir rearme; não entrar em instrumento ilíquido/spread inadequado. Definir spread/volume com dados autorizados, não presumir limiares universais.
- `DISARMED`, `READ_ONLY`, `MANUAL_PAPER`, `AUTO_PAPER`; `LIVE` não deve existir no código executável desta versão. Kill switch persistente, acessível na UI, desativa novas ordens (cancelar/liquidar é comando distinto com confirmação e auditoria).
- Estratégia baseline simples e reprodutível escolhida entre código já existente e estratégia-test-fixture; backtest sem look-ahead, com custos assumidos explícitos. Candidato de estratégia nunca substitui baseline sem teste fora da amostra. Não prometer rentabilidade.

## F. Interface elegante e verdadeira

Sidebar curta: `Overview`, `Markets`, `Orders`, `Portfolio`, `Strategies`, `Risk`, `AI Research`, `Connections`, `System`.
- Overview: equity, cash, buying power, drawdown, performance, broker ativo, worker heartbeat, feed/latência e últimos sinais. Com fallback `— / dados indisponíveis` quando não há origem. Proibir gráfico de equity sintético no painel operacional.
- Markets: instrumentos da conta, watchlist, candles e quotes com origem e atraso identificados; filtros de mercado.
- Orders: ticket paper manual com validação de precisão e risco; lista, estados, fills, cancel/replace segundo permissões; eventos auditáveis.
- Portfolio: posições, custo médio, P&L realizado/não realizado, histórico real de snapshots.
- Strategies: versão fixada, presets de risco, períodos de teste, sinal, razões de entrada/saída, benchmarks.
- Risk: limites correntes, exposição por broker/ativo, bloqueios, kill switch e justificações.
- AI Research: modelo instalado/digest, consumo CPU/RAM, relatórios, tarefas pendentes, resultados do estudo ablation sem IA.
- Connections: `Guardar e testar` / `Ativar` / `Desativar` / `Rotacionar`; campo secreto nunca sai do servidor depois da escrita. A validação de chave NÃO equivale a permissão para enviar ordens. Exibir permissões verificadas individualmente.
- System: logs estruturados e sanitizados, últimas reconciliações, latência, feed freshness, falhas, estado worker, Oracle/Netlify deploy id, uptime e alertas.
- Usabilidade mobile real, teclado, contraste, estados loading/empty/error, confirmações claras. Preservar cores originais TailAdmin, sem temas próprios extra.

## G. Segurança e persistência

- Credenciais Alpaca previamente partilhadas no chat devem ser rodadas. Não as integrar no prompt, repo, zip, código, logs ou outputs. Configuração segura no dashboard autenticado ou no secret manager/variables do host; toda a cifra e desencriptação só no backend.
- Cifrar secrets em repouso com AES-256-GCM, master key em variável de ambiente do backend, jamais no Git; criar processo de backup e rotação, com permissões mínimas. Migrar gradualmente qualquer Netlify Blobs vault para o backend sem expor segredo ao browser.
- Autenticação robusta com proteção contra brute force, MFA/SSO onde possível, sessões revogáveis, CSRF, SameSite, CSP, TLS, CORS restrito e auditoria. Evitar endpoints administrativos públicos abertos. Não expor portas de PostgreSQL ou Ollama na Internet.
- Backups automáticos verificáveis, retention definida, hora NTP, proteções de restart e lock de worker único; nunca ter dois executores simultâneos para a mesma conta.
- Respeitar limites gratuitos dos fornecedores, disponibilizar aviso antes de criar recursos faturáveis e não afirmar custo zero antes de verificar elegibilidade.

## H. Deploy e ordem de ativação

1. Inspecionar código real PRAXIS, produzir inventário e plano dos diffs; manter um deployment preview protegível do TailAdmin Netlify.
2. Montar backend e DB na VM gratuita (preferência Oracle ARM64 quando disponível), configurar firewall, HTTPS, serviços persistentes e backups; conectar à dashboard por API autenticada (um único controlo de autenticação).
3. Instalar Ollama local, descarregar `qwen3:1.7b`, testar a saúde e memória; desligar LLM sem afetar ordens.
4. Registar novas credenciais na vault privada e descobrir contas/capacidades/entitlements. GETs reais e históricos; sinalizar acesso parcial.
5. Validar OMS/risk/idempotência com mocks que injetam falhas e restart e com sandbox REST/SSE.
6. Ativar `MANUAL_PAPER`, abrir/cancelar/fechar ordens mínimas fictícias e reconciliar posições.
7. Ativar `AUTO_PAPER` SOMENTE depois de todos os critérios de segurança e testes da secção I passarem, com autorização fornecida neste pedido apenas para negociação fictícia e com os limites de risco iniciais. Definir explicitamente broker/conta/demo permitidos na configuração; nunca live por engano.
8. Iniciar período de 60 dias de forward-testing com baseline fixa e métricas diárias. Não alterar regras a meio da janela sem iniciar nova versão/experiência. Runbook de incidentes e desarme.
9. Se não houver acesso à VM/Netlify/OAuth ou credenciais novas, deixar o sistema 100% pronto e com gates bloqueados, reportar EXATAMENTE o bloqueio; não declarar negociação ativa nem falsificar prints.

## I. Gates de aceitação (obrigatórios)

- 100% dos endpoints/contas de trading no ambiente autorizado de Paper/Sandbox (teste em runtime, não só string).
- 0 segredos no Git, respostas, frontend, logs, artefactos e relatórios.
- Idempotência: timeout após POST aceite -> UMA ordem, nunca duplicada; SSE duplicado -> UM fill; crash/restart -> posição reconciliada.
- Feed atrasado ou ausência de timestamp/DB -> nenhuma nova ordem; risco cobre precisão, permissões e perdas.
- Kill switch tem efeito verificável antes do próximo envio; estado desarmado sobrevive ao restart.
- cTrader Demo só é armado se OAuth e conta demo verificados. Alpaca pode funcionar sem cTrader.
- Ollama é opcional, local, isolado de segredos e não impede o worker de cumprir o seu prazo; teste de indisponibilidade do LLM sem parar o loop determinístico.
- Dashboard usa apenas dados reais ou placeholders explícitos; equity calculada de ledger/snapshots; feed e permissões identificados.
- `npm test`, migrations, integração, contract tests, lint, build e E2E com screenshots Netlify preview; tests de API reais registados com data/hora e IDs redigidos.
- Deploy publicado e ativo só se a cloud estiver acessível. Mostrar URLs observadas, estado de heartbeat confirmado, conta fictícia, último sinal, último ciclo de reconciliação, última ordem fictícia (se elegível) e métricas, sem promessas inventadas.

## J. Entregáveis do Codex

- Código integrado no repositório PRAXIS (preservando funcionalidades), PR/revisão e guia de rollback.
- Docker Compose/systemd, scripts idempotentes de provisionamento para ARM64, scripts de migração/backup/restore, Netlify config sem segredos.
- `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `DEPLOY.md`, `RUNBOOK.md`, `BROKER_CAPABILITIES.md`, `60_DAY_EXPERIMENT.md`.
- Relatório auditável de teste, endpoints verificados, account_id mascarado, model digest, última reconciliação e resumo do que **ainda NÃO está funcional**.
- Checklist final `READY / BLOCKED / RUNNING PAPER` por Alpaca Broker, Trading Paper, cTrader, Market Data, Ollama, dashboard, DB, monitorização.

## K. Referências de implementação a consultar
- Alpaca Broker: https://docs.alpaca.markets/us/docs/getting-started-with-broker-api
- Ordens Broker Sandbox: https://docs.alpaca.markets/us/reference/createorderforaccount
- Eventos trades SSE: https://docs.alpaca.markets/us/reference/subscribetotradev2sse
- Market Data: https://docs.alpaca.markets/us/docs/about-market-data-api
- cTrader Auth: https://help.ctrader.com/open-api/account-authentication/
- Ollama Linux: https://docs.ollama.com/linux
- Ollama model: https://ollama.com/library/qwen3:1.7b
- Netlify: https://docs.netlify.com/build/functions/configuration/

COMEÇA AGORA por inventariar o código do PRAXIS e reportar os riscos críticos encontrados; continua a implementação de forma incremental, sem interromper por perguntas não essenciais. Apenas aguarda passos explícitos do proprietário para ligar contas cloud, aprovar autorizações OAuth ou fornecer novas chaves por canal seguro. O objetivo final é **PAPER AUTÓNOMO OPERACIONAL**, NUNCA LIVE.
