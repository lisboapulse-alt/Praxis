> **PRAXIS v0.3 DEMO_UNRESTRICTED — nota prioritária:** em contas fictícias NÃO impor limites financeiros locais por exposição, perda, número de ordens ou posições; preservar apenas isolamento demo, idempotência, segurança de credenciais, validação técnica de ordens e métricas observacionais. Em caso de contradição, seguir `docs/ALTERACOES_DEMO_V3.md`.

# Guia de deploy (Codex) — não executado

## Preferência: uma VM + Caddy (menos complexidade)

1. Criar instância Always Free elegível (disponibilidade não garantida) e configurar acesso SSH por chave; confirmar IP, disco persistente, firewall e riscos de cobrança. Não ativar recursos pagos automaticamente.
2. Instalar Node 22.16+ e Caddy via pacotes oficiais, criar utilizador `praxis` sem shell e pastas `/opt/praxis`, `/var/lib/praxis` e `/etc/praxis` com permissões mínimas.
3. Copiar o projeto para `/opt/praxis`; criar `/etc/praxis/praxis.env` com PRAXIS_DB=/var/lib/praxis/praxis.sqlite e segredos. Master key nunca deve ser gravada no Git; restrição 0600 na env.
4. Usar `ops/praxis.service` para systemd; verificar `systemctl status praxis`, `journalctl -u praxis`, `/api/health`, backup/restore real. Publicar apenas Caddy HTTPS 443; API HTTP deve ouvir em `127.0.0.1:8787`.
5. Opcionalmente instalar Ollama segundo documentação oficial, expor apenas `127.0.0.1:11434` e executar `ops/ollama-setup.sh` para `ollama pull qwen3:1.7b`; medir RAM/CPU antes de o ligar ao PRAXIS.
6. Testar interface, login e GETs de paper sem ordens. Não armar automaticamente no arranque.

## Se mantivermos Netlify UI + VM API

1. Ter backend HTTPS em subdomínio dedicado, com firewall e limitação de acesso.
2. Configurar no ambiente **de build** Netlify `PRAXIS_BACKEND_HTTPS_URL=https://api.sua-conta.tld` (URL pública, **não** contém credenciais). Build executa `scripts/netlify-config.mjs`, que cria um proxy same-origin `public/_redirects` de `/api/*`.
3. Configurar `PRAXIS_PUBLIC_ORIGIN=https://seu-site.netlify.app` na VM para Origin de operações de escrita, e `PRAXIS_COOKIE_SECURE=1`; cookies HttpOnly/SameSite Strict são geridos pelo backend.
4. Confirmar proxy com GET health e login em preview e produção; conferir cookies e cabeçalhos. Não publicar o backend sem TLS.
5. Netlify Functions não devem executar o worker; ele reside sempre na VM.

## Backups

- Manter `PRAXIS_DB` em disco persistente, criar backups online com `ops/backup.sh`, executar restauração de ensaio e verificar leitura do estado de desarme.
- Proteger também o segredo AES: sem `PRAXIS_VAULT_KEY`, os segredos cifrados são irrecuperáveis. Guardar cópia segura fora do repositório.
- As chaves partilhadas anteriormente no chat devem ser renovadas antes do deployment acessível pela internet.

## Operação

- `DISARMED` é o estado inicial, `kill_switch=1` no SQLite.
- `MANUAL_PAPER`/`AUTO_PAPER` só podem ser armados após autenticação e verificação de conta; `AUTO_PAPER` exige feed IEX.
- Interrupção controlada do processo executa `disarm()`. Crash abrupto deixa estado persistido; a reconciliação de intenções desconhecidas tem de ser validada em implantação real.
- **IMPORTANTE:** para operação 60 dias, é necessária avaliação de confiabilidade após interrupções, heartbeat/alertas fora do servidor, lock exclusivo do worker, reconciliação de ordens externas e plano de restart. Estes itens não estão concluídos nesta base.
