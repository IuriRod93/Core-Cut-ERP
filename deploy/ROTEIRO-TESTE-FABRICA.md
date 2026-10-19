# Roteiro de teste em fábrica (1 projeto real, do início ao fim)

Faça com um projeto pequeno de verdade (ex.: um armário). Marque cada passo e anote o que travou ou confundiu.

## 0. Antes de começar (30 min)
- [ ] **Configurações → Empresa**: razão social, CNPJ, endereço, telefone, e-mail e logo (saem no contrato e na proposta).
- [ ] **Estoque**: cadastre as chapas que a fábrica usa (medida real da chapa e custo) e a fita de borda.
- [ ] **Produção → setores**: crie os setores (corte, coladeira, usinagem, montagem) com o **custo por hora** de cada um.
- [ ] **Equipe**: um usuário por pessoa, com o perfil certo (operador só vê o Chão de fábrica).
- [ ] **Segurança**: troque a senha do admin e confirme que o backup externo está rodando.

## 1. Comercial
- [ ] Cadastre o cliente (com **e-mail e telefone**: são usados nos avisos).
- [ ] Crie o projeto e o orçamento; aprove o orçamento.
- [ ] Gere o contrato (os dados do projeto e o valor entram sozinhos) e confira o PDF.

## 2. Plano de corte
- [ ] Importe as peças (Promob/CSV) ou digite; escolha **Seccionadora**.
- [ ] Se o projeto tiver uma única ordem de produção ativa, confirme que o plano foi vinculado a ela e que as peças aparecem nos itens da ordem.
- [ ] Calcule. Confira: aproveitamento, **ordem dos cortes** e sobras sugeridas.
- [ ] Imprima o PDF de distribuição e **corte uma chapa seguindo os números**: a serra executa na ordem?
- [ ] **Guarde as sobras** que valem a pena em Estoque → Retalhos e confira que o retalho aparece com a medida certa.

## 3. Compras e estoque
- [ ] Gere a solicitação de compra pelo plano e confira o **saldo do orçamento**.
- [ ] Registre o recebimento e confira a entrada no estoque.

## 4. Chão de fábrica
- [ ] Ao criar o projeto, confirme que foi aberta uma ordem em **Planejada** com uma etapa para cada setor ativo; complete os itens antes de liberar.
- [ ] Libere a ordem de produção; no tablet/celular do setor, **inicie, pause e conclua** cada etapa.
- [ ] No projeto, confirme que as etapas da ordem aparecem como tarefas na lista **Produção** e acompanham os apontamentos do chão de fábrica.
- [ ] No projeto, confira a aba **Visão geral**: andamento por etapa e o painel **Custo real do projeto**.

## 5. Entrega, cliente e pós-venda
- [ ] Agende a entrega/instalação e acompanhe a rota.
- [ ] No projeto: **… → Atualizar o cliente**. Ative o link, abra em uma aba anônima e confirme que **não aparece valor nenhum**.
- [ ] Envie a mensagem por WhatsApp e por e-mail (o e-mail precisa do SMTP configurado).
- [ ] Faça um pedido de ajuda pelo link do cliente e confirme que cai em **Garantias e assistência técnica**.
- [ ] No chamado, agende a visita ("Agendar visita na agenda") e conclua.

## 6. Fechamento
- [ ] **Comissões**: gere a comissão do orçamento aprovado e confira o valor liberável conforme o cliente paga.
- [ ] **Custo real do projeto**: o desvio faz sentido? Ajuste custo/hora e preço dos materiais se não fizer.

## O que anotar
1. Onde a equipe travou ou perguntou "e agora?".
2. Qual número do sistema não bateu com a realidade (tempo de corte, custo, aproveitamento).
3. O que ainda é feito em papel ou planilha.

Com essas três listas, o próximo ciclo de melhorias sai direto do uso real.
