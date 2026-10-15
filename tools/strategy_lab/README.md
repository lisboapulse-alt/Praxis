# PRAXIS Strategy Lab — recolha externa

Este componente é um processo independente para contornar a ausência de DNS/rede no ambiente de ficheiros do ChatGPT. Usa GitHub Actions (cron, aproximadamente uma vez por hora, sujeito a atrasos) e APIs públicas Coinbase Exchange + Kraken como alternativa. Não acede a brokers nem emite ordens.

## Dados e auditoria

O programa testa `BTC-USD` e `ETH-USD` com 31+ velas consecutivas fechadas de 1 minuto, carimbadas em UTC. Cada previsão tem ID determinístico, fonte, instrumento, preço inicial, instante de emissão, instante-alvo, estratégia e versão. Os sinais são `MOM20`, `MR30`, `BASE_LAST`, cada um com horizontes 5/15/60 minutos. Probabilidades não calibradas são nulas. Só valida previsões anteriores, usando a mesma fonte e a vela com fecho UTC exatamente no instante-alvo.

Ficheiros gerados em `research/strategy_lab/data/`: `latest.json` (amostra de velas e proveniência), `predictions.jsonl` (append-only), `validations.jsonl` (append-only), `runs.jsonl` (append-only) e `scorecard.json`. Sem candles verificáveis, apenas regista a falha.

**Importante:** o repositório é público; não incluir segredos, contas, ordens nem dados privados. O Excel persistente da Biblioteca ChatGPT não é diretamente acessível ao GitHub Actions. A tarefa horária do ChatGPT deve importar as novas previsões e validações destes ficheiros para `/PRAXIS Strategy Lab/PRAXIS_Strategy_Lab.xlsx` por ID, sem reescrever linhas antigas. Antes do primeiro evento confirmado em GitHub Actions, a recolha ainda não é considerada operacional.

`on.schedule` do GitHub pode atrasar, falhar ou ser desativado após inatividade; conferir a página Actions e as permissões de escrita do repositório.