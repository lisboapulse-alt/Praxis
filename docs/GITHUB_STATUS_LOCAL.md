# Verificação local antes da publicação GitHub

Fonte: `PRAXIS_OS_V042_FASE_A_MARKET_DATA.zip`.

- Repositório Git local preparado com branch `main` e `.gitignore` reforçado; ainda **não** foi criado/publicado um repositório remoto.
- Revisão preventiva de padrões de credenciais nos ficheiros rastreados: sem correspondência para a chave Basic conhecida partilhada anteriormente, private keys ou tokens GitHub. `.env.example` é um template de configuração, não um ficheiro de segredos ativos.
- `npm run check`: PASSOU (Node v22.16.0; validação sintática).
- `npm test`: 56 testes passaram, 3 falharam e 1 foi cancelado. A instalação de `ws` não estava disponível localmente, e o projecto exige Node >=24. Por isso a suite completa **não** está aprovada neste ambiente. Executar `npm ci`, `npm run build`, `npm run check` e `npm test` em Node 24 no GitHub Actions para obter resultado definitivo.
- Integração real com contas Alpaca e VM cloud: não testada nem publicada.

Nenhuma credencial deve ser adicionada ao GitHub, nem ao repositório privado.
