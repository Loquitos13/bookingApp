# Plano de UI — template de marcações

Objetivo: transformar a app atual num **template** que qualquer negócio de marcações possa adotar. Tem de ser mobile-first, muito intuitivo, com animações cuidadas e rápido em qualquer dispositivo. Todo o conteúdo é **fictício** e fácil de substituir.

---

## 0. Decisão prévia: stack da UI

| Opção | Prós | Contras |
|---|---|---|
| **A. Manter Express + EJS** + CSS próprio + JS vanilla (recomendado) | Já funciona e está testado. Primeira pintura muito rápida (HTML do servidor, ~0 KB de framework). Funciona sem JS. Fácil de alojar. | Não dá para usar os componentes 21st.dev/shadcn diretamente; seriam recriados à mão, inspirados neles. |
| **B. Migrar o front para Next.js + Tailwind + shadcn + Motion** (back office e site), mantendo a lógica de `src/` como API | Acesso ao catálogo 21st.dev e a animações de layout mais ricas. | Reescrita grande de todas as views. Mais JS no telemóvel. Mais complexo de alojar. |

**Recomendação: A.** O plano abaixo vale para as duas opções. Só muda a implementação dos componentes (secção 9).

---

## 1. Princípios

1. **Uma ação principal por ecrã.** No site a ação é sempre "Marcar". No back office é "Nova marcação".
2. **O polegar primeiro.** Em telemóvel, as ações principais ficam na metade de baixo do ecrã: barra fixa inferior e bottom sheets.
3. **Nunca mostrar becos sem saída.** Só aparecem dias e horas realmente livres. Os estados vazios explicam sempre o que fazer a seguir.
4. **Feedback imediato.** Cada toque responde em menos de 100 ms (estado *pressed*). As operações lentas mostram skeleton, nunca um ecrã branco.
5. **A animação serve para orientar, não para decorar.** As durações são curtas (120–280 ms) e tudo respeita `prefers-reduced-motion`.
6. **Funciona sem JS.** Os formulários são HTML normal e o JS melhora a experiência por cima (progressive enhancement).

---

## 2. Dados fictícios (modo template)

- **Negócio:** "Equilíbrio — Fisioterapia & Osteopatia" (nome inventado), com morada genérica, telefone `+351 210 000 000` e email `@exemplo.pt`.
- **Seed alargado** (`npm run seed:demo`):
  - 3 profissionais e 6 serviços;
  - ~60 marcações espalhadas pelas últimas 2 semanas e pelas próximas 3, com todos os estados e as duas origens (site e manual);
  - 6 mensagens (3 por ler), 2 bloqueios (um feriado e umas férias) e 4 testemunhos;
  - 6 perguntas frequentes (FAQ).
  - As datas são **relativas a hoje**, para a demo nunca parecer desatualizada.
- **Avatares:** iniciais sobre a cor do profissional, sem fotos de pessoas reais. As imagens do hero e do espaço são ilustrações SVG abstratas ou fotos de banco de imagens com licença livre, e são fáceis de trocar.
- **Faixa "Modo demonstração"** (variável `DEMO=1`): banner discreto e botão "Repor dados de demonstração" no back office. No login aparecem as credenciais de demo já preenchidas.
- **Ficheiro único de branding:** `config/brand.json` com nome, cores, tipografia, logótipo e textos. O back office também o edita.

---

## 3. Design system

**Tokens (variáveis CSS, com tema claro e escuro):**
- **Cor:** `--brand` (primária), `--accent`, `--bg`, `--surface`, `--ink`, `--muted`, `--line`, e os de estado `--ok`, `--warn`, `--err`, `--info`. O contraste mínimo é AA (4.5:1). O tema escuro aplica-se automaticamente no back office e é opcional no site.
- **Tipografia:** serifa de display (Fraunces) para títulos e Inter para a interface. A escala é fluida com `clamp()` (12 → 56 px) e usa números tabulares nas horas e preços.
- **Espaçamento:** escala de 4 px (4, 8, 12, 16, 24, 32, 48, 72).
- **Raio:** 10 / 14 / 20 / pílula. **Sombras:** 2 níveis.
- **Alvos de toque:** ≥ 44×44 px. Os inputs têm ≥ 16 px de letra, para o iOS não fazer zoom.
- **Breakpoints (mobile-first):** base < 640, `sm` 640, `md` 900, `lg` 1200.

**Componentes base:** botão (primário, secundário, ghost, perigo e estado de carregamento), input/select/textarea com label flutuante opcional, checkbox/switch, chip (opções de serviço e profissional), badge de estado, card, lista, tabela que vira cartões no telemóvel, toast, bottom sheet, modal, tabs/segmented control, skeleton, empty state, avatar, stepper e calendário.

---

## 4. Sistema de animação

| Momento | Animação | Duração / curva |
|---|---|---|
| Toque em botão/chip | `scale(.97)` + escurecer | 100 ms, ease-out |
| Seleção de chip/horário | Fundo e borda; o ✓ entra com fade + scale | 160 ms |
| Mudar de passo no wizard | Slide horizontal 24 px + fade (sentido conforme avançar/recuar) | 240 ms, `cubic-bezier(.2,.8,.2,1)` |
| Horários a carregar | Skeleton com shimmer, depois entrada em stagger (20 ms por item, máx. 12) | 180 ms |
| Mudar de mês no calendário | Slide da grelha na direção do mês | 220 ms |
| Bottom sheet | Sobe com spring; o fundo escurece; fecha com gesto de arrastar para baixo | ~300 ms |
| Toast | Entra de baixo (telemóvel) ou do canto (desktop) e sai sozinho aos 4 s | 200 ms |
| Confirmação de marcação | Check desenhado em SVG (stroke) + confetti subtil, só 1 vez | 600 ms |
| Navegação entre páginas | **View Transitions API** (cross-document) com fade de 150 ms e o resumo/cartão "morfado" entre páginas | 200 ms |
| Secções do site ao fazer scroll | Fade-up 16 px, uma vez, via `IntersectionObserver` / `animation-timeline: view()` | 400 ms |
| Agenda: nova marcação | O bloco expande a partir do slot clicado | 220 ms |

Regras: animar só `transform` e `opacity`. Com `prefers-reduced-motion` tudo passa a fades de 0–80 ms. Nada pisca mais de 3 vezes por segundo.

---

## 5. Site público

### 5.1 Estrutura global
- **Header:** logótipo à esquerda e botão "Marcar" sempre visível. Em telemóvel, o menu abre num sheet de ecrã inteiro. O header encolhe e ganha fundo ao fazer scroll.
- **Barra fixa inferior (só telemóvel):** `[📞 Ligar] [Marcar consulta]`. Esconde-se ao fazer scroll para baixo e volta ao subir. Não aparece na página de marcação.
- **Footer:** contactos, horário, links legais (Privacidade, Termos e Livro de Reclamações, este último obrigatório em PT) e redes sociais.

### 5.2 Página inicial (por ordem de scroll em telemóvel)
1. **Hero:** título, uma frase de apoio e o CTA "Marcar consulta". Por baixo, a **pré-visualização de disponibilidade**: "Próximo horário livre: hoje às 16:30", que é tocável e leva diretamente ao wizard com o serviço e o dia já escolhidos.
2. **Provas de confiança:** avaliação média ★ 4,9 (fictícia), nº de clientes e seguros/acordos (logótipos fictícios).
3. **Serviços:** carrossel horizontal com scroll-snap no telemóvel e grelha no desktop. Cada cartão mostra nome, duração, preço e "Marcar".
4. **Como funciona:** 3 passos com ícones.
5. **Equipa:** cartões. Ao tocar, abre um sheet com a bio, os serviços que faz e "Marcar com a Ana".
6. **Testemunhos:** carrossel com snap.
7. **FAQ:** acordeão (`<details>` animado).
8. **Localização e horário:** mapa estático (imagem, sem iframe pesado), botão "Abrir no Maps" e horário de hoje destacado ("Aberto agora · fecha às 19:30").
9. **Contacto:** formulário curto e link de WhatsApp.

### 5.3 Wizard de marcação (o mais importante)
**Telemóvel:** um passo por ecrã, com barra de progresso no topo (`1 Serviço · 2 Profissional · 3 Data · 4 Dados`) e um botão fixo em baixo que mostra o contexto (ex.: "Continuar · Sessão 45 min · 40 €").
**Desktop:** tudo numa página, com resumo fixo à direita (como agora), mas com as transições entre passos.

1. **Serviço:** lista de chips grandes, com pesquisa se houver mais de 8 serviços. Escolher um serviço avança automaticamente.
2. **Profissional:** "Sem preferência" está pré-selecionado. Os avatares mostram "1.º livre: amanhã 09:00". Se só um profissional faz o serviço, o passo é saltado.
3. **Data e hora:**
   - Fita horizontal de 14 dias (dia da semana + número) com os dias sem vagas esbatidos. O botão "Ver calendário" abre o mês completo num sheet.
   - Horários agrupados em Manhã / Tarde / Fim do dia, como chips em grelha de 3 colunas.
   - Quando há pouca disponibilidade, aparece um indicador "Últimas vagas".
   - Se o dia escolhido estiver cheio, o primeiro dia livre seguinte é sugerido.
4. **Dados:** nome, telemóvel (teclado `tel`) e email, com `autocomplete` correto e validação inline ao sair do campo (não ao escrever). As notas ficam escondidas atrás de "+ Adicionar nota". O consentimento é uma linha simples.
5. **Revisão e confirmação:** cartão-resumo com "Editar" em cada linha (volta ao passo certo). O botão "Confirmar marcação" tem estado de carregamento.

Extras:
- O estado do wizard fica no URL (`?servico=2&dia=2026-11-18`), por isso o botão "voltar" do browser e a partilha funcionam.
- **Rascunho:** se o utilizador sair a meio, os dados ficam em `sessionStorage`.
- **Conflito** (alguém reservou entretanto): toast "Esse horário acabou de ser ocupado", a lista de horários é recarregada e o mais próximo fica destacado.

### 5.4 Confirmação e gestão da marcação
- Check animado, resumo em cartão estilo "bilhete" e ações: **Adicionar ao calendário** (.ics e Google), **Como chegar**, **Partilhar** (Web Share API), **Reagendar** e **Cancelar**.
- O cancelamento abre um sheet de confirmação com motivo opcional.
- Novo: **reagendar online** (o mesmo seletor de data/hora dentro de um sheet), respeitando o prazo.

### 5.5 Páginas de sistema
404, erro, "marcação não encontrada" e páginas legais, sempre com o mesmo layout e um CTA de saída.

---

## 6. Back office

### 6.1 Navegação
- **Telemóvel:** **tab bar inferior** com 5 itens (Hoje · Agenda · Marcações · Mensagens · Mais) e um **FAB "+"** central para nova marcação. "Mais" abre um sheet com Serviços, Equipa, Horário, Bloqueios e Definições.
- **Tablet/desktop:** sidebar que pode ser recolhida (só ícones) e **paleta de comandos ⌘K** para pesquisar clientes ou referências e saltar para qualquer página.
- Atalhos de teclado no desktop: `N` nova, `T` hoje, `←/→` dia anterior/seguinte na agenda e `/` pesquisa.

### 6.2 Painel "Hoje"
- Saudação e data. Faixa de KPIs com scroll horizontal no telemóvel: Hoje, Por confirmar, Semana e Faturação prevista, com números animados (count-up de 400 ms).
- **Timeline do dia:** a próxima marcação fica em destaque ("Daqui a 25 min · Rita Almeida · Avaliação"). Cada marcação tem ações rápidas em swipe no telemóvel: → Concluída, ← Faltou.
- Pedidos por confirmar no topo, com os botões "Confirmar" e "Recusar" diretamente.
- Gráfico pequeno de ocupação dos próximos 7 dias (barras).

### 6.3 Agenda
- **Telemóvel:** vista de **um profissional de cada vez** (tabs com avatar, que mudam com swipe) ou vista **lista do dia**. Em cima há uma fita de dias. Ao tocar num espaço livre abre-se o sheet "Nova marcação" com hora e profissional já preenchidos.
- **Tablet/desktop:** colunas por profissional (como agora) mais as vistas **Semana** e **Mês** (pontos de ocupação). Linha vermelha da hora atual. **Arrastar para reagendar** e esticar a margem inferior para mudar a duração, com confirmação.
- Legenda de cores por estado e filtro por profissional.

### 6.4 Marcações
- Lista com pesquisa fixa no topo e filtros como chips (Hoje, Esta semana, Por confirmar, Canceladas). No desktop é uma tabela; no telemóvel, cartões.
- Seleção múltipla para ações em massa: confirmar, exportar ou enviar lembrete.
- **Detalhe:** sheet lateral no desktop e ecrã inteiro no telemóvel. Mostra o cliente com Ligar / WhatsApp / Email num toque, o estado como segmented control, o reagendamento com o seletor de horários reais, as notas internas e o histórico do cliente com timeline.

### 6.5 Nova marcação (rápida)
Formulário curto, num sheet:
- **Cliente:** autocomplete pelos clientes existentes (preenche telefone e email).
- **Serviço** em chips, depois **horários livres** em chips (os mesmos componentes do site) e o **profissional**.
- Toggle "Encaixe" para ignorar a disponibilidade e toggle "Enviar confirmação".

### 6.6 Configuração
- **Serviços e Equipa:** lista que se ordena com drag (handle) e edição em sheet. Pré-visualização de como aparece no site.
- **Horário:** um cartão por dia com toggle, mais "copiar para todos os dias úteis". O horário pode ser **por profissional** (expansão futura).
- **Bloqueios:** calendário com intervalos marcados; criar um bloqueio arrastando dias.
- **Definições:** secções em acordeão. **Aparência** (cor da marca com pré-visualização ao vivo, logótipo, tipografia) e **Textos do site**.
- **Onboarding** na primeira utilização: checklist "Configure o seu negócio" (dados → serviços → equipa → horário → partilhar o link).

### 6.7 Clientes (novo)
Lista de clientes gerada a partir das marcações, com ficha, nº de visitas, faltas, última visita e notas.

---

## 7. Acessibilidade

- HTML semântico. O wizard usa `fieldset/legend` e os horários usam `radiogroup` com navegação por setas.
- Foco visível e gerido: ao mudar de passo, o foco vai para o título do passo; os sheets e modais têm *focus trap* e fecham com `Esc`.
- `aria-live` para "A carregar horários…", nos erros e nos toasts.
- Contraste AA nos dois temas. Não depender só da cor: os estados têm texto e ícone.
- Testado com VoiceOver (iOS) e TalkBack.

---

## 8. Performance e dispositivos

- **Orçamentos:** LCP < 1,8 s em 4G, CLS < 0,05, INP < 150 ms. JS no site < 25 KB gzip e CSS < 20 KB.
- **Fontes:** só as variantes usadas, com `font-display: swap` e preload da principal. Opção de fontes locais.
- **Imagens:** AVIF/WebP com `srcset`, `loading="lazy"`, dimensões fixas.
- **CSS crítico inline** no `<head>` das páginas públicas.
- **PWA** no back office: manifest e ícone, para o dono do negócio o instalar no telemóvel. Cache offline da agenda do dia.
- Safe areas (`env(safe-area-inset-*)`), unidades `dvh`, `touch-action` e `overscroll-behavior` nos sheets.
- **Testar em:** iPhone SE (375), iPhone 15 (393), Android médio (360/412), iPad (768/1024), laptop 1366 e desktop 1920. Também em modo paisagem.

---

## 9. Implementação de componentes

- **Opção A (EJS):** cada componente é um partial EJS (`views/components/*.ejs`) mais CSS em camadas (`@layer tokens, base, components, utilities`) e pequenos módulos JS (`sheet.js`, `toast.js`, `wizard.js`, `calendar.js`, `swipe.js`). Os componentes 21st.dev servem só de **referência visual**.
- **Opção B (React):** procurar no 21st.dev os candidatos para hero, carrossel de serviços, testimonials, FAQ/accordion, calendar/date picker, time slot picker, stepper, bottom sheet/drawer (Vaul), command palette (cmdk), data table, toast (Sonner) e sidebar. Instalar via registry shadcn e adaptar aos tokens.
  - O plano gratuito permite apenas 2 instalações por dia, por isso a ordem de prioridade é: date/slot picker → drawer → command palette → data table.

---

## 10. Fases de entrega

| Fase | Conteúdo | Critério de "feito" |
|---|---|---|
| 1. Fundações | Tokens, tema escuro, componentes base, sistema de animação, seed demo, modo demo | Página de "kitchen sink" com todos os componentes; seed com datas relativas |
| 2. Wizard mobile-first | Passos em ecrã, fita de dias, slots, revisão, conflito, rascunho | Marcação completa em < 30 s num iPhone SE, só com o polegar |
| 3. Site | Hero com próximo horário, carrosséis, equipa em sheet, testemunhos, FAQ, mapa, barra inferior, View Transitions | Lighthouse ≥ 95 em todas as categorias no telemóvel |
| 4. Confirmação/gestão | Bilhete, .ics, partilha, reagendar online | Reagendar sem ligar para o negócio |
| 5. Back office mobile | Tab bar + FAB, Hoje com swipe, agenda por profissional, sheet de nova marcação | Criar uma marcação manual em < 15 s no telemóvel |
| 6. Back office desktop | Semana/mês, drag-to-reschedule, ⌘K, ações em massa, clientes | Reagendar arrastando, com desfazer |
| 7. Personalização | Aparência ao vivo, onboarding, PWA | Trocar marca e cores sem tocar no código |
| 8. QA | Acessibilidade, matriz de dispositivos, reduced-motion, testes Playwright visuais | Zero erros de axe; screenshots de referência aprovadas |
