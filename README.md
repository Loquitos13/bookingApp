# Template de marcações — site + reservas online + back office

Template para negócios que trabalham por marcação (clínicas, salões, estúdios, explicações…). Cada instalação serve um negócio. A demo usa um exemplo fictício, "Equilíbrio — Fisioterapia & Osteopatia". Todo o conteúdo específico do setor é editável no back office.

Stack: Node.js 22.13+, Express, EJS e SQLite (incluído no Node). Não precisa de base de dados externa nem de *build*. O design está documentado em `DESIGN.md` e o produto em `PRODUCT.md`.

## Arrancar

```bash
npm install
npm start          # http://localhost:3000  ·  back office em /admin
npm test           # 24 testes
```

Na primeira execução é criada `data/app.db` com **dados de demonstração fictícios**: 3 profissionais, 5 serviços, um pacote, cerca de 800 marcações em 12 semanas de histórico e 3 semanas de futuro, clientes recorrentes, mensagens, férias e um feriado.

- **Login de demonstração:** `admin@exemplo.pt` / `admin123`.
- **Para entregar a um cliente:** arranque com `DEMO=0` e defina `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

Com Docker: `docker compose up -d`. O `docker-compose.yml` tem todas as variáveis comentadas e guarda a base de dados no volume `/data`.

## Funcionalidades

**Site público** (português e inglês)
- **Página inicial:** placa com o nome do negócio, painel de "Próximas vagas" reais (com aviso de "Última vaga"), serviços e pacotes, equipa, horário com "Aberto agora", perguntas frequentes e contacto.
- **Marcação:** um passo por ecrã (serviço → profissional → dia e hora → dados). O botão Voltar do browser funciona entre passos.
- **Lista de espera:** quando nenhum horário serve, o cliente é avisado por email se vagar.
- **Bilhete:** adicionar ao calendário (.ics e Google), como chegar, partilhar, **mudar dia ou hora** e cancelar, até X horas antes.
- **Pagamento de sinal online** (opcional): cartão, MB WAY e Multibanco via Stripe.
- **Legal:** política de privacidade, link para o Livro de Reclamações, e consentimento ao marcar.
- **SEO:** `sitemap.xml`, `robots.txt`, dados estruturados *LocalBusiness*, imagem de partilha e *hreflang*.

**Back office** (`/admin`, instalável como app no telemóvel)
- **Hoje:** agenda do dia, pedidos por confirmar (um toque para confirmar ou recusar) e lista de espera.
- **Agenda:** vistas Dia, Semana e Mês, filtro por profissional e **arrastar para mudar a hora** (com Desfazer). Mostra feriados e folgas, e tem uma folha do dia para imprimir.
- **Marcações:** pesquisa, filtros e exportação CSV.
  - **Ficha da marcação:** estado, reagendamento com horários livres, notas e pagamento.
  - **Séries:** marcações semanais ou quinzenais, com cancelamento "esta e as seguintes".
- **Clientes:** histórico, visitas, faltas, valor gasto, notas, pacotes, atalhos (ligar, WhatsApp, email) e **RGPD** (exportar e apagar dados).
- **Pacotes de sessões:** uma sessão é descontada automaticamente quando uma marcação é concluída.
- **Estatísticas:** ocupação, faltas, faturação, clientes novos e habituais, marcações por semana, serviços e horas.
- **Equipa:** serviços que cada pessoa faz, **horário próprio de cada profissional** e **calendário pessoal** (link .ics para o Google, iPhone ou Outlook).
- **Utilizadores e papéis:**
  - Dono: acesso a tudo.
  - Receção: sem definições do negócio nem estatísticas.
  - Profissional: só a sua agenda e as suas marcações.
- **Definições:**
  - textos, contactos e idioma inglês;
  - **marca** (cor de destaque com pré-visualização e logótipo);
  - regras de marcação e feriados automáticos;
  - lembretes e pedidos de avaliação;
  - pagamento de sinal;
  - informação legal.

**Tarefas automáticas** (correm a cada 5 minutos dentro do servidor)
- Lembrete por email (e por SMS ou WhatsApp, opcional) X horas antes.
- Pedido de avaliação no Google depois de uma consulta concluída. No máximo um por cliente a cada 6 meses.
- Aviso à lista de espera quando vaga um horário.
- Libertação de horários com pagamento não concluído.
- Cópia de segurança diária da base de dados (`data/backups`, guarda 14 dias). Também se pode fazer à mão com `npm run backup`.

**Segurança**
- **Limite de pedidos:** por IP nos formulários e na API, e no máximo N marcações futuras por email.
- **Anti-spam:** Cloudflare Turnstile, opcional.
- **Cabeçalhos:** CSP com *nonce* (sem JavaScript inline), HSTS em produção, CSRF no back office e cookies `HttpOnly`.
- **Palavras-passe e login:** palavras-passe com scrypt e bloqueio após várias tentativas falhadas.
- **Pagamentos:** o webhook da Stripe é verificado pela assinatura.

## Adaptar a um cliente

1. **Marca:**
   - Em Back office → Definições → Marca, escolha a cor de destaque e carregue o logótipo.
   - Depois corra `npm run icons` para gerar os ícones da app e a imagem de partilha com a inicial e a cor.
   - Para mudanças mais profundas, os *tokens* estão em `public/css/tokens.css`.
2. **Textos, contactos e regras:** Back office → Definições.
3. **Serviços, pacotes, equipa, horários e férias:** nas secções respetivas do back office.
4. **Acessos:** Definições → Utilizadores.
5. **Política de privacidade:** reveja `/privacidade` com o caso concreto. O texto é um modelo e não substitui aconselhamento jurídico.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `PORT` | Porta (por omissão 3000) |
| `BASE_URL` | URL público, usado nos links dos emails, no sitemap e no calendário (ex.: `https://www.minhaclinica.pt`) |
| `DB_PATH` | Ficheiro SQLite. Os uploads e as cópias de segurança ficam na mesma pasta |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Utilizador inicial (dono) |
| `DEMO=0` | Não criar dados de demonstração |
| `NODE_ENV=production` | Cookies só por HTTPS, HSTS e `upgrade-insecure-requests` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`, `NOTIFY_EMAIL` | Envio real de emails. Sem estas variáveis, os emails são escritos na consola |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS (ou WhatsApp, com `TWILIO_FROM=whatsapp:+…`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagamento de sinal. Configure o webhook para `https://…/webhooks/stripe` com os eventos `checkout.session.*` |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Anti-spam Cloudflare Turnstile nos formulários |
| `RATE_LIMIT=0`, `BACKUPS=0` | Desligar o limite de pedidos ou as cópias automáticas (útil em testes) |

## Estrutura

```
server.js                 Express, cabeçalhos, webhook Stripe, PWA, /health
src/db.js                 Esquema, migrações aditivas, dados iniciais
src/availability.js       Horários livres (por profissional, feriados, bloqueios), marcar/reagendar atómico
src/routes/public.js      Site, API de disponibilidade, marcação, bilhete, lista de espera, SEO, .ics
src/routes/admin.js       Back office (papéis, agenda, clientes, estatísticas, definições…)
src/scheduler.js          Lembretes, avaliações, lista de espera, pagamentos expirados, cópias
src/payments.js           Stripe Checkout + verificação do webhook
src/mailer.js             Emails e SMS/WhatsApp
src/i18n*.js              Traduções PT/EN do site público
src/security-mw.js        Limite de pedidos, Turnstile, CSP
src/holidays.js           Feriados nacionais (incluindo os móveis)
src/demo.js               Dados de demonstração fictícios (datas relativas a hoje)
views/                    Páginas EJS (public/, admin/, partials/)
public/                   CSS (tokens, site, picker, admin), JS, fontes, ícones da app
scripts/icons.js          Gera ícones e imagem de partilha com a marca do cliente
test/                     Testes (node --test)
```
