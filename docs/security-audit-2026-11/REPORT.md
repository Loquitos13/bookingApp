# Auditoria de segurança: bookingApp (run 2)

## 1. Âmbito e método

- **Perfil:** `quick`. É uma passagem parcial, não uma cobertura completa.
- **Âmbito:** server.js, src/, views/, public/js/, Dockerfile, docker-compose.yml e package.json. A pasta .claude/ (skills instaladas) ficou de fora.
- **Código revisto:** b488c0a2e6984b098d88048d835fabae9f5e5273, com a worktree limpa.
- **Orçamento:** 12 agentes previstos, 11 usados:
  - 4 de reconhecimento;
  - 3 hunters;
  - 1 crítico final;
  - 3 verificadores independentes, que no perfil quick fazem também a verificação final dos registos.
- **Execução:** leitura de código e verificações locais limitadas, sempre dentro de uma sandbox imposta pelo sistema operativo (scratchpad/sandbox.sh). A sandbox tem:
  - rede só com loopback;
  - todos os mounts só de leitura, exceto o scratch do agente;
  - ambiente vazio (`env -i`);
  - limites de recursos com `prlimit` e de tempo com `timeout`.

  As evidências foram promovidas para `agents/<id>/artifacts/` pelo script do coordenador (descritores, sem seguir links, com limites de tamanho). Não foi enviado tráfego a nenhum serviço real (Stripe, Twilio, Turnstile, SMTP).
- **Run anterior:** deixou 11 candidatos por validar e não produziu findings.json. O código mudou em todos esses pontos, por isso foram todos revistos de novo como trabalho atual. Nenhum resultado foi herdado como confirmado.
- **Cobertura adiada:** o crítico final propôs 3 unidades novas. Pelo perfil quick ficaram `deferred` (ver secção 7).

## 2. Postura de segurança

As fronteiras principais aguentam:
- tokens de marcação aleatórios de 192 bits;
- CSRF em todos os POST autenticados;
- controlo de papéis normalizado;
- SQL com placeholders, ou concatenado só com números;
- EJS escapado e CSP com nonce;
- webhook com HMAC;
- upload validado pelos bytes do ficheiro.

As falhas confirmadas são todas de isolamento entre profissionais dentro do back office e têm impacto baixo. A pista de pagamentos depende de como a conta Stripe de cada negócio está configurada.

## 3. Problemas confirmados

| Gravidade | Título | Fronteira | Resultado observado |
|---|---|---|---|
| baixa | Um profissional consegue passar as suas marcações para a agenda de outro com `action=move` | papel profissional → agenda de outro profissional | A marcação R1 passou do profissional 1 para o 2. A rota irmã `action=reschedule` recusou o mesmo pedido. |
| baixa | O histórico do cliente na ficha da marcação mostra marcações de outros profissionais | papel profissional → marcações de outros profissionais | A ficha da Ana listou marcações do profissional 2. Abrir essas marcações diretamente deu 403. |

### 3.1 `action=move` sem a verificação do próprio profissional
- **Onde:** src/routes/admin.js:484-489 chama `rescheduleBooking` (src/availability.js:146-153) com o `staffId` do pedido. Não passa por `moveBooking`, que tem a verificação (src/routes/admin.js:293).
- **Quem:** um utilizador autenticado com o papel profissional, numa marcação sua.
- **Reprodução com dados fictícios:**
  - pedido: `POST /admin/marcacoes/<id> action=move&date=2030-01-08&time=10:00&staffId=2`;
  - a variante com `staffId` vazio também funciona quando o próprio profissional está ocupado a essa hora.
- **Resultado:** a marcação fica com `staff_id` 2 e a Ana passa a receber 403 nela (agents/v-move/artifacts/check-1.txt).
- **Impacto e prioridade:** afeta só a integridade da agenda de um colega. Não expõe dados pessoais.
- **Correção:** forçar `staffId = ownStaff(req)` e fazer `rescheduleBooking` recusar o horário, em vez de recorrer a `slot.staff[0]`. Acrescentar um teste de regressão no lado dos papéis.

### 3.2 Histórico do cliente sem filtro por profissional
- **Onde:** src/routes/admin.js:445-450. O histórico procura só pelo email do cliente e é mostrado em views/admin/booking.ejs:109.
- **Quem:** um profissional. Como pode mudar o email na sua própria marcação (`action=details`), consegue ver o histórico de qualquer email.
- **Resultado:** aparecem data, hora, serviço e estado de marcações de outros profissionais, até 10 por email (agents/v-history/artifacts/check-1.txt).
- **Correção:** acrescentar `AND b.staff_id = ?` quando o papel é profissional, e um teste de regressão.

## 4. Por validar (sem gravidade atribuída)

| Pista | Caminho no código | O que bloqueia | Próximo passo local | Verificação pelo dono |
|---|---|---|---|---|
| O webhook Stripe dá como paga uma marcação com uma sessão de checkout alheia, qualquer que seja o valor | server.js:26 → src/payments.js:84, 90, 99 → 93 | Se a conta Stripe tem outras fontes de eventos `checkout.session` (Payment Links, outras integrações, outra instalação com IDs iguais) e se o endpoint as recebe | Já observado: uma sessão alheia de 50 USD confirmou uma marcação com sinal de 5000 cêntimos (agents/v-stripe/artifacts/check-1.txt). Teste de regressão: exigir `obj.id === payment_ref`, valor ≥ `deposit_cents` e moeda eur | No Stripe Dashboard, em modo de teste e só a ler: ver se existem Payment Links ou outras integrações e a que eventos o endpoint está subscrito |

## 5. Recomendações de reforço (não são problemas confirmados)

- **Demo:** com `DEMO` vazio, que é o caso de um `docker run` simples, a imagem arranca em modo demo com `admin@exemplo.pt`/`admin123` mostrado na página de login. Recusar o modo demo sob `NODE_ENV=production`, a não ser que `DEMO=1` esteja definido.
- **Palavra-passe no log:** a palavra-passe inicial é escrita no log mesmo quando vem de `ADMIN_PASSWORD`.
- **Login e logout:** `/admin/login` aceita POST de outros sites (login CSRF) e `/admin/logout` não tem token. Verificar `Sec-Fetch-Site`/`Origin`.
- **Cache das páginas:** as páginas do back office não têm `Cache-Control: no-store`. A cópia offline do service worker só é limpa quando se abre a página de login.
- **Email:**
  - `EMAIL_RE` aceita vírgulas, o que permite contornar o limite de marcações por email;
  - o nome do cliente mantém quebras de linha nos emails enviados.
- **Calendário:** o `.ics` não remove U+2028, U+2029, U+0085 nem `\x0b`.
- **Logótipo:** a validação de WebP não exige o prefixo `RIFF`, e `/uploads` não tem CSP.
- **Turnstile:** a verificação não tem tempo limite.
- **Agenda:** `?staff=Infinity` dá erro 500, sem injeção possível.
- **Erros cedo:** o tratamento de erros depende de variáveis da vista, o que nas rotas iniciais e sem `NODE_ENV=production` mostra o stack trace.
- **Série:** `cancel_series` não filtra por profissional (a unidade ficou adiada, ver 7).
- **Implementação:**
  - `BASE_URL` deveria ser obrigatório em produção;
  - o docker-compose publica a porta 3000 em todas as interfaces;
  - `TRUST_PROXY=true` faz o arranque falhar.

**O que está bem feito:**
- os tokens vêm de `crypto.randomBytes`;
- palavras-passe com scrypt e comparação em tempo constante;
- o webhook falha fechado;
- o cookie de sessão é HttpOnly, SameSite=Lax e Secure em produção;
- o nome do logótipo é gerado pelo servidor;
- as transações usam `BEGIN IMMEDIATE`;
- os emails são só texto;
- o nodemailer codifica as quebras de linha no assunto.

## 6. Cobertura

O ledger tem 20 unidades: 14 cobertas, 3 com candidato e 3 adiadas.
- **Verificadores:** os 3 candidatos foram decididos de forma independente. 2 confirmados e 1 por validar; nenhum rejeitado.
- **Crítico final:** pediu 3 unidades novas e nenhuma reatribuição. Com o perfil quick, não houve segunda vaga de hunters.

## 7. Cobertura adiada (`quick_profile_final_critic`)

1. Se o apagar de dados (RGPD) fica completo. Pontos em causa:
   - as notas e os pacotes são procurados com o email exato, sem ignorar maiúsculas;
   - as cópias de segurança guardam os dados apagados durante 14 dias;
   - a cópia offline do service worker.
2. As tarefas automáticas e a lista de espera:
   - a expiração do pagamento em corrida com um webhook atrasado;
   - avisos enviados para emails não verificados;
   - um GET que muda o estado.
3. Outros caminhos entre profissionais: `cancel_series` e `/api/reagendar`.

Estas unidades não foram revistas nesta passagem e não devem ser tratadas como sem problemas.

---

## Depois da auditoria (commit seguinte a b488c0a)

Os problemas confirmados, a pista da Stripe e a maior parte das recomendações foram corrigidos. Cada correção tem um teste de regressão em `test/audit.test.js` ou `test/payments.test.js`, e esses testes falham contra o código auditado:

- **`action=move`:** o profissional fica preso à sua coluna (`strictStaff`).
- **Histórico do cliente:** passa a mostrar só as marcações do próprio profissional.
- **`cancel_series`:** um profissional só cancela as suas marcações da série.
- **Webhook Stripe:** exige que a sessão seja a guardada em `payment_ref`, valor ≥ `deposit_cents` e moeda eur. Um evento `completed` não pago vindo de outra sessão também é ignorado.
- **Email e nomes:** emails com `, ; < > " ( )` são recusados, e nomes e telefones ficam numa só linha.
- **`.ics`:** remove U+2028, U+2029, U+0085 e caracteres de controlo.
- **Login e logout:** pedidos com `Sec-Fetch-Site: cross-site` são recusados.
- **Back office:** responde com `Cache-Control: no-store`.
- **Outros:**
  - a validação de WebP exige o prefixo `RIFF`;
  - a verificação Turnstile tem um tempo limite de 5 s;
  - `?staff=` só aceita inteiros positivos;
  - o apagar (RGPD) de notas e pacotes ignora maiúsculas;
  - o modo demo deixa de ligar por omissão com `NODE_ENV=production`;
  - a palavra-passe passada em `ADMIN_PASSWORD` deixa de ir para o log.

**O que continua por fazer** (unidades adiadas e recomendações sem alteração):
- as cópias de segurança guardam os dados apagados durante 14 dias;
- a corrida entre a expiração do pagamento e um webhook atrasado;
- o GET de saída da lista de espera;
- `BASE_URL` obrigatório;
- a porta do docker-compose;
- `TRUST_PROXY=true`;
- o tratamento de erros nas rotas iniciais.
