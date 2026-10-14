# PRAXIS v0.3 — Demo sem limites financeiros artificiais

## Pedido aprovado
O utilizador pretende testar livremente ordens e estratégias nas contas **Alpaca Paper / Broker Sandbox**, removendo travões locais que não são necessários para a fase de simulação.

## Removido
- Teto de 2% de equity por ordem;
- Exposição global de 10%;
- Limite de 3 posições simultâneas;
- Limite de 5 ordens por dia;
- Travões por drawdown/perda diária;
- Restrição artificial a vendas sem posição existente (corretora decide se permite short);
- Bloqueio global causado por ordens aceites ainda não preenchidas;
- Confirmações duplicadas na interface para armar e enviar ordem manual;
- Obrigação de feed IEX para testar uma ordem manual de mercado.

## Mantido (não são travões financeiros)
- Não há ligação a endpoints LIVE nem código para operar dinheiro real;
- Sessões autenticadas, segredos cifrados e proteção contra pedidos de outras origens;
- Registo e `client_order_id` único por sinal para não duplicar ordens devido a retries/timouts;
- Reconciliação de resultados incertos; em Demo não impede sinais novos distintos;
- Verificação de conta ativa, formato de ordem e integridade temporal dos sinais automáticos;
- Botão Parar Ordens: interrompe novos envios, mas não cancela ordens já aceites.

## Nota operacional
Ordens rejeitadas por insuficiência de fundos, mercados fechados, permissões de venda a descoberto e restrições do broker são parte do teste e devem aparecer nos relatórios. A base SMA 5/20 continua a dimensionar as compras em ~1,9% da equity como parâmetro da estratégia, e **não** como limite global de risco. O Codex deve tornar o dimensionamento configurável na UI se necessário. Não foi realizada qualquer ordem autenticada nem deploy.

## Critérios Codex
1. Continuar a integração original sem reintroduzir limites financeiros rígidos no perfil DEMO_UNRESTRICTED.
2. Completar dados de mercado, ordens limit/stop, cancel/replace, eventos de fills e reconciliação.
3. Manter métricas de P&L, drawdown e rejeições apenas para observação no modo demo.
4. Só permitir a escolha de contas Sandbox/Paper, nunca LIVE.
5. Não esconder a realidade: se a corretora rejeitar uma ordem, mostrar o motivo e contabilizá-lo.
