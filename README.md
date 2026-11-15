# Template de marcações — site + reservas online + back office

Aplicação completa para um negócio que trabalha por marcação (exemplo configurado: **clínica de fisioterapia e osteopatia**).
Serve igualmente para cabeleireiros, barbearias, estética, nutrição, explicações, etc. — basta mudar textos, serviços e equipa no back office.

## O que inclui

**Site público**
- Página informativa: apresentação, serviços com preço e duração, equipa, horário, contactos e formulário de mensagem.
- Marcação online em 4 passos: serviço → profissional (ou "sem preferência") → calendário com dias/horas realmente livres → dados do cliente.
- Página pessoal da marcação (link enviado por email): bilhete, adicionar ao calendário (.ics / Google), como chegar, partilhar, **mudar dia ou hora** e cancelar, até X horas antes.

**Back office** (`/admin`)
- Painel com indicadores (hoje, próximos 7 dias, por confirmar, faturação prevista do mês).
- Agenda em vistas **Dia / Semana / Mês**, filtro por profissional, e **arrastar uma marcação** para mudar hora, profissional ou dia (com "Desfazer"). Toque num espaço livre para marcar.
- **Clientes**: lista criada a partir das marcações, ficha com histórico, visitas, faltas, notas internas e atalhos (ligar, WhatsApp, email); autocompletar ao criar marcações.
- **App instalável** (PWA): o back office pode ser instalado no telemóvel, abre em ecrã inteiro e mostra a última agenda vista mesmo sem rede.
- Lista de marcações com pesquisa/filtros, exportação CSV, ficha da marcação (alterar estado, reagendar, notas internas, histórico do cliente).
- Marcações manuais (telefone/balcão), com opção de "encaixe" fora da disponibilidade.
- Gestão de serviços, equipa (cor na agenda, serviços que presta), horário semanal com pausa de almoço, férias/feriados/bloqueios.
- Mensagens do formulário de contacto.
- Definições: textos do site, contactos, intervalo entre horários, pausa entre marcações, antecedência mínima/máxima, prazo de cancelamento, confirmação automática ou manual.

## Arrancar

Requer Node.js 22.13+ (usa o SQLite incluído no Node — sem base de dados externa).

```bash
npm install
npm start          # http://localhost:3000  ·  back office em /admin
npm test
```

Na primeira execução é criada a base de dados `data/app.db` com **dados de demonstração fictícios** (negócio, equipa, ~150 marcações com datas relativas a hoje, mensagens e bloqueios) e o utilizador
`admin@exemplo.pt` / `admin123` (**altere em Definições**, ou defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` antes do primeiro arranque).

## Adaptar a um cliente

1. **Marca:** em `public/css/tokens.css` (um único ficheiro para site e back office), mude `--signal`, `--signal-press` e `--on-signal` (cor de destaque) e, se quiser, `--board` (cor do painel). Depois corra `npm run icons` para gerar os ícones da app com a inicial do negócio. O resto do sistema está em `DESIGN.md`.
2. **Textos, contactos, regras:** Back office → Definições.
3. **Serviços, equipa, horário, férias:** secções respetivas do back office.
4. **Tirar os dados fictícios:** arranque a primeira vez com `DEMO=0` (base de dados vazia de marcações), ou desligue "modo demonstração" e apague `data/app.db` antes de entregar.

## Variáveis de ambiente

| Variável | Para quê |
|---|---|
| `PORT` | Porta (por omissão 3000) |
| `BASE_URL` | URL público, usado nos links dos emails (ex.: `https://www.minhaclinica.pt`) |
| `DB_PATH` | Caminho do ficheiro SQLite |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Utilizador inicial do back office |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Envio real de emails. Sem isto, os emails são apenas escritos na consola |
| `MAIL_FROM`, `NOTIFY_EMAIL` | Remetente e email que recebe os avisos de novas marcações |
| `NODE_ENV=production` | Cookie de sessão só por HTTPS |
| `DEMO=0` | Não criar dados de demonstração na primeira execução |

## Estrutura

```
server.js               Express + EJS
src/db.js               Esquema SQLite e dados iniciais
src/availability.js     Cálculo de horários livres e criação atómica de marcações
src/routes/public.js    Site, API de disponibilidade, marcação, cancelamento
src/routes/admin.js     Back office
src/auth.js             Sessões, login, proteção CSRF
src/mailer.js           Emails ao cliente e ao negócio
views/                  Páginas (public/ e admin/)
public/                 CSS e JS do calendário
test/                   Testes (node --test)
```
