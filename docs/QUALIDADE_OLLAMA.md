# Avaliação real de Ollama / qwen3:1.7b

Três tarefas executadas localmente: classificação de notícia, explicação SMA e hipóteses económicas. Inputs, outputs completos, latência, tokens e amostras de saúde estão em `reports/ollama-benchmark.json`. Modelo instalado do registo oficial; `think:false`, temperatura 0, contexto 2048, uma thread, geração até 280 tokens.

**Inferência operacional, qualidade factual insuficiente para decisões autónomas.** Na classificação, o modelo chamou uma subida de taxas «estímulo»; na formulação de hipóteses, associou uma redução de taxas a diminuição de inflação sem suporte. A resposta SMA melhorou após grounding explícito, mas esse grounding não eliminou os erros macroeconómicos.

Não atribuímos uma nota quantitativa de qualidade a três exemplos. As respostas não são validação de uma estratégia nem autoridade para operar. Os erros foram preservados no relatório, não corrigidos silenciosamente ou rotulados como aprovados. A UI informa o problema observado. Todo o uso permanece investigação textual sujeita a revisão humana, isolada de ordens, parâmetros e vault.

Modelo indisponível não bloqueia o OMS; timeout/busy gate devolvem erro só no endpoint de pesquisa. Controlo de memória/restart do serviço limita o impacto no host. O benchmark de saúde HTTP durante geração não comprova latência de ordens nem execução durante 60 dias.
