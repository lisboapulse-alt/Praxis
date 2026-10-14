# Instalação, publicação e operação

## Estado desta sessão

Código instalado e testado na VM gerida do Codex. Backend de desenvolvimento em loopback 8787; Ollama em loopback 11434. `.env` privado foi gerado localmente e **não integra a entrega ZIP**. Não existe acesso à Oracle, domínio, Netlify, credenciais broker. Não se iniciou experiência de 60 dias nem negociação real Demo nesta sessão.

Ollama: binário oficial Linux amd64 0.40.3, `qwen3:1.7b` oficial Q4_K_M, camadas verificadas SHA-256. Como `ollama pull` falhou ao seguir downloads de blobs através da rede/proxy da VM, os blobs foram obtidos do registo oficial com curl pela ligação permitida e instalados por `scripts/download-ollama-model.py`. Manifesto em `/workspace/runtime/ollama/qwen3-manifest.json`; pesos em `/workspace/runtime/ollama/models`. O supervisor user-level é `ops/supervise-ollama.mjs`, com env reduzido (sem PRAXIS/vault), reinício 5s e verificação RSS 3 GiB. A VM não executa systemd. O controlo RSS user-level é periódico, não um cgroup hard limit; produção usa `MemoryMax` systemd.

## VM Oracle existente (sem criar recursos pagos)

Confirmar quotas Always Free, arquitetura/disco/RAM e política de custos na conta. Recomendação a avaliar: 8 GiB+ RAM e 2+ CPUs; 4 GiB poderia suportar inferência limitada, mas precisa de novo benchmark. A medição desta sessão não demonstra capacidade em ARM nem estabilidade 60 dias. Reservar RAM/CPU para o worker; Ollama um único contexto/modelo, CPUQuota 100%, Nice 10, MemoryMax 3G. Pesos ~1,36 GB mais binário/runtime; reservar espaço para DB/logs/backups e medir crescimento.

Na VM existente instalar Node 24 LTS, curl, zstd e systemd. Não instalar serviços cloud nem subscrições pagas pelo script.

```bash
npm ci
npm run build
sudo bash ops/install.sh
sudo bash /opt/praxis/ops/ollama-setup.sh
```

`install.sh` cria utilizador praxis, `/opt/praxis`, `/var/lib/praxis`, `/etc/praxis/praxis.env`, serviço backend e timer de backup. Segredos aleatórios são criados uma única vez e ficheiro 0600. A chave de vault deve ser preservada independentemente dos backups DB. **Não** publicar este ficheiro nem imprimir valores em relatórios. Instalação Ollama é utilizador separado, sem EnvironmentFile PRAXIS.

Backend `ops/praxis.service`: reinício 35s após falha (lease dura 30s), limite 750MB, diretórios privados, journald, proteção systemd. Não existem testes de instalação systemd/Oracle nesta sessão porque PID 1 não é systemd e não há acesso Oracle.

## HTTPS e Netlify

Usar Caddy/reverse proxy em VM, exemplo `ops/Caddyfile.example`. Expor apenas HTTPS; não expor 8787 nem 11434. Configurar DNS/HTTPS existentes. Ativar sincronização UTC (chrony/systemd-timesyncd do host) e confirmar `timedatectl status`; scripts não tentam alterar o relógio do container.

Backend env privado (Node 24: `NODE_USE_ENV_PROXY=1` para ambientes com HTTP proxy; preservar CA/NO_PROXY herdados):

```dotenv
PRAXIS_PUBLIC_ORIGIN=https://o-dashboard.netlify.app
PRAXIS_COOKIE_SECURE=1
```


Netlify: site estático `public/`, build `npm run build && node scripts/netlify-config.mjs`, variável **não secreta** `PRAXIS_BACKEND_HTTPS_URL=https://api.example.com`. O script gera `_redirects` same-origin `/api/*` para backend HTTPS. Chaves e password administrativa ficam somente na VM; não em Netlify. Testar Set-Cookie/Origin real do proxy antes de operar. Não foi feito deploy externo nesta sessão.

GitHub: o código está preparado para repositório próprio; nenhum repositório remoto foi fornecido, criado ou modificado. Usar código da entrega, excluir `.env`, state e node_modules conforme `.gitignore`.

## Credentials e Paper

1. Login com password do ficheiro privado do host.
2. Broker Connections: selecionar cartão Alpaca correto, introduzir chaves **renovadas**, Guardar e ativar. Credenciais nunca migram de Broker para Trading.
4. Trading Terminal: descobrir contas, escolher conta, armar Manual Paper; validar ordem, fills, cancelamento e reconciliação.
5. Markets: confirmar feed/permissões IEX, candles, trades/quotes e timestamp. O painel não presume SIP/Level 2.
6. Após todos os testes Demo reais e requisitos de recuperação, armar AUTO_PAPER na conta Trading Paper durante mercado aberto. Esta ação autoriza ordens fictícias e inicia prazo persistido de 60 dias.

Kill switch suspende novas ordens; não cancela automaticamente ordens já enviadas. Cancelar explicitamente ordens pendentes e reconciliar. Reinício retoma somente uma autorização persistida válida após reconciliação; disarm explícito elimina autorização de retoma.

## Backups e recuperação

Timer diário 03:00 UTC. Backup online via node:sqlite inclui WAL, ficheiro 0600. Retenção não apaga backups automaticamente; controlar disco e copiar para armazenamento externo privado já autorizado. Não enviar backups que contêm vault cifrado para local público.

```bash
sudo -u praxis bash /opt/praxis/ops/backup.sh /var/backups/praxis
sudo systemctl stop praxis
sudo -u praxis node /opt/praxis/ops/restore.mjs /var/backups/praxis/backup.sqlite /var/lib/praxis/restored.sqlite
```

Restaurar para ficheiro **novo**, verificar integridade, configurar PRAXIS_DB para esse ficheiro, preservar vault key, arrancar e verificar reconciliação. UNKNOWN/SUBMITTING nunca são reenviadas cegamente. Teste local de backup/restore executado; armazenamento off-host não foi configurado.

## Monitorização

System Monitor mostra heartbeat, RSS Node, conexões/streams, ciclo, DB, Ollama, alertas e audit. Alertas são persistidos localmente; não há email/Slack/SMS configurados. Monitor externo recomendado para `/api/health` (sem credenciais); não há provedor externo provisionado. Journald persiste de acordo com configuração do host (`Storage=persistent` e retenção); validar disco e `journalctl -u praxis -u ollama`.

O relatório diário lê DB sem contactar brokers/IA. O worker recolhe equity mesmo sem browser aberto. Dados stale bloqueiam AUTO. LLM indisponível devolve 503 só em pesquisa; OMS não depende do modelo.
