> Atualização v0.4.1: por instrução do utilizador, o cTrader foi removido integralmente da implementação, testes e interface. As referências abaixo registam a auditoria e a implementação histórica v0.4. A versão atual usa apenas Alpaca e acrescenta liquidação de posições.

# Auditoria PRAXIS OS v0.4

2026-10-13. Fonte: ZIP `PRAXIS_OS_V03_DEMO_SEM_LIMITES_CODEX.zip`, 32 ficheiros, 160060 bytes. Inventário por ficheiro e SHA-256 em `ZIP_INVENTORY.json`. O workspace não continha outro repositório; pesquisa nos repositórios GitHub ligados não encontrou PRAXIS. O utilizador confirmou que não tem URL. Não foi possível auditar nem integrar modelos/estratégias de um PRAXIS original não fornecido.

O ZIP original foi extraído sem modificações em `/workspace/PRAXIS_OS_PRE_CODEX_V3_DEMO`. A implementação está em `/workspace/praxis-os-v04`. Os relatórios e prompts antigos estão em `docs/legacy-v03`; não descrevem o estado desta entrega.

## Problemas encontrados e tratamento

| Gravidade | Evidência v0.3 | Alteração v0.4 | Validação |
|---|---|---|---|
| Crítica | `submitIntent` guardava kill/mode antes de `await account()` | Geração persistente, verificação após preflight e guard imediatamente antes do envio | Testes de kill durante validação e despacho |
| Alta | `arm` podia reativar depois de um kill concorrente | Ativação condicionada à mesma geração; mudança transacional | Teste de arm interrompido |
| Alta | Reconciliação consultava só UNKNOWN/SUBMITTING | Acompanha estados não terminais, histórico de ordens, fills e posições | Aceite → filled; fills deduplicados |
| Alta | Restart desarmava definitivamente | Pausa, verifica conta/dados/reconciliação, retoma modo anteriormente autorizado; kill explícito impede retoma | Reinício do processo HTTP e testes de DB |
| Alta | Não havia exclusão de segundo worker | Lease SQLite com renovação; segundo proprietário é recusado | Teste de lease/expiração |
| Alta | Market bars sem ordem explícita podiam devolver candles antigos | `sort=desc`, normalização crescente UTC, OHLC obrigatório, staleness | Testes de dados e fluxo HTTP |
| Alta | Scripts Ollama apenas diziam para instalar | Instalação efetiva local, pesos oficiais com hashes, supervisor e systemd | Benchmark real de três tarefas |
| Alta | cTrader inexistente | OAuth, WSS JSON Demo, auth, filtros Live, símbolos, barras, ordens, posições, P&L, fills, refresh token | Testes de protocolo simulado; conta real pendente |
| Média | Sizing auto usava 1,9% da equity | Quantidade experimental configurável, sem teto financeiro local | Parâmetros versionados |
| Média | Sem eventos/fills/barras/sinais/versões persistidos | Tabelas SQLite e transações; índices únicos de sinal/intenção/fill/evento | Testes de persistência e backup WAL |
| Média | Mesma chave de pedido permitia mudança de parâmetros | Identidade por broker/conta/sinal e conflito 409 | Teste de quantidade/lado alterados |
| Média | Formulário manual gerava ID novo em cada tentativa | ID mantido em memória durante pedido ambíguo; botão desativado em curso | Fluxo browser e idempotência HTTP |
| Média | Backtest/replay/monitor eram cartões pendentes | Módulos operacionais ligados a API/SQLite; CSV explícito para investigação | Testes core + browser |
| Média | Fonte Outfit declarada mas não disponibilizada | Fonte local e licença; CSS original TailAdmin vendorizado e compilado | Build e browser desktop/mobile/dark |
| Média | Badge do motor OFF e kill constante não refletiam estado | Estado recebido de `/api/engine` | Browser |
| Baixa | Sessões stateless e secret de assinatura não usados | Eliminados; mantidas sessões SQLite revogáveis | Logout/revogação HTTP |
| Baixa | Documentação histórica referia ficheiros ausentes e validações antigas | Arquivada e substituída por documentação com evidências atuais | Inventário e relatórios |

## Componentes preservados

Backend HTTP Node, cofre AES-256-GCM, autenticação administrativa, allowlist fixa Paper/Sandbox, journal de intenções antes de POST, perfil DEMO_UNRESTRICTED, separação Alpaca Broker/Trading, layout/cor azul, kill switch, scripts de backup e proxy Netlify. Não introduzidos microserviços, Kafka, Kubernetes, APIs de IA pagas nem novas contas cloud.

## Limites remanescentes

AUTO está implementado inicialmente para Alpaca Trading Paper. Broker Sandbox e cTrader têm execução manual via adaptador; AUTO nesses brokers aguarda validação dos respetivos relógios/sessões/permissões. OAuth cTrader necessita aplicação e redirect HTTPS registado. Nenhum adaptador foi validado numa conta Demo real nesta sessão. Nenhum histórico real de mercado estava acessível sem credenciais; estatísticas de rentabilidade ficam indisponíveis. O LLM usa só texto submetido: não há aquisição automática de notícias. Profit Factor de forward trading e P&L líquido realizado exigem ledger completo de custos/round trips. Alterações de ordens Alpaca geram ID de substituição que será reconciliado; não constituem reenvio cego de intenções.
