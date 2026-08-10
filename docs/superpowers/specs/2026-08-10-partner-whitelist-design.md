# Lista de Parceiros (Whitelist) para Posts de Parcerias Externas

## Contexto / Problema

O bot hoje monitora o stream de blocos da Hive e processa automaticamente
qualquer post de nível raiz que tenha a tag `hivebr`/`hive-br`, rodando um
motor de pontuação (`calculateBaseVoteScore`) baseado em KE, delegação,
ranking, verificação, trilha de voto e staff.

Existe uma parceria com a comunidade japonesa que funciona fora desse fluxo:
um representante envia diariamente, em um canal do Discord, os links dos
posts de ~5 autores fixos (sempre 1 post por autor por dia — confirmado
com o time). Hoje a equipe precisa copiar cada link manualmente e rodar
`!vote autor/permlink 50` para cada um, com o voto sempre fixo em 50%.
Esse processo é manual, repetitivo e não deixa claro no canal de curadoria
que aquele post é de uma parceria.

Objetivo: eliminar o passo manual de copiar/colar + votar, mantendo
controle de quem participa da parceria (lista administrável, autores podem
entrar ou sair) e uma indicação visual clara desses posts no canal onde o
bot já publica os posts da comunidade.

## Decisões de design

1. **Lista única e "achatada"** de parceiros (`list_parceiros`) — sem
   grupos nomeados por parceria. Decisão consciente de simplicidade
   ("começar com calma"). Se no futuro surgir mais de uma parceria com
   necessidades diferentes (peso de voto, identidade visual), o modelo
   pode evoluir para grupos nomeados sem quebrar o que existe hoje.
2. **Detecção via blockchain**, não via canal de links. Como a cadência é
   sempre 1 post por autor por dia, o bot pode observar diretamente pelos
   usernames cadastrados na whitelist, do mesmo jeito que já observa a tag
   `hivebr` — sem depender de alguém colar o link manualmente no Discord.
3. **Peso do voto único e global** para toda a lista (não por pessoa),
   configurável em runtime via comando, com padrão de 50%.
4. **Fluxo sempre manual** (botão de voto) nesta primeira versão — sem
   votação automática. Resolve o problema original (parar de digitar
   `!vote` na mão) sem precisar decidir sobre automação ainda.
5. `!vote autor/permlink valor` continua existindo como via manual de
   exceção, para autores fora da whitelist.

## Arquitetura

### Armazenamento

- Novo arquivo `partners.json` no `DATA_DIR` — array simples de usernames
  Hive, no mesmo padrão de `blacklist.json`/`users.json`.
- Novo arquivo de texto simples no `DATA_DIR` (mesmo padrão de
  `getLastProcessedBlock`/`updateLastProcessedBlock`, que já guarda um
  número em um arquivo) para o peso de voto atual da lista. Padrão de 50
  quando o arquivo ainda não existe.
- Novo módulo `src/partners.ts`, espelhando `src/users.ts`:
  - `getPartnerUsers(): Promise<string[]>`
  - `savePartnerUsers(users: string[]): Promise<void>`
  - `getPartnerVoteWeight(): Promise<number>`
  - `setPartnerVoteWeight(value: number): Promise<void>`
- `seedDataFiles()` passa a semear também `partners.json` e o arquivo de
  peso, seguindo o mecanismo de seed já existente (`seed-data/`).

### Detecção (`processBlock`)

Fluxo atual: para cada `commentOp` de nível raiz (`parent_author === ''`),
verifica se a tag é `hivebr`/`hive-br` → chama `processPost`.

Nova checagem, executada apenas quando a tag **não** bateu: se
`postData.author` está em `partners.json` → chama `processPartnerPost`.

A tag `hivebr`/`hive-br` tem prioridade sobre a whitelist de parceiros —
se um autor estiver nos dois grupos, o post segue o fluxo normal da
comunidade (evita processar/publicar o mesmo post duas vezes).

### `processPartnerPost` (novo, paralelo a `processPost`)

Reaproveita do fluxo existente:
- Checagem de blacklist (bloqueia o voto mesmo estando em `list_parceiros`)
- Checagem de Hivewatchers
- `getPostInfo` (busca dados do post)
- Checagem de timestamp (ignora edições, só processa posts novos)
- `getSameDayPostInfo` (evita voto duplicado no mesmo autor no mesmo dia)

Não reaproveita:
- `calculateBaseVoteScore` — o motor de pontuação da comunidade HiveBR
  (KE, delegação, ranking, staff etc.) não se aplica a autores de fora do
  ecossistema de delegação da HiveBR.

Fluxo:
1. Roda as checagens de segurança acima (blacklist, Hivewatchers, mesmo
   dia, timestamp).
2. Busca o peso de voto atual com `getPartnerVoteWeight()`.
3. Monta um embed simplificado: thumbnail, título, autor, link, campo
   "🤝 Post de Parceria" mostrando o peso fixo, com uma cor de embed
   distinta da usada nos posts com tag `hivebr` (diferenciação visual).
4. Publica no mesmo canal de curadoria já usado hoje, com botão
   "🚀 VOTE!" (`customId` no formato `autor/permlink/peso`, igual ao já
   usado pelo fluxo da comunidade — **nenhuma mudança necessária** no
   handler de clique de botão existente) e botão "View Post".

### Comandos Discord (restritos à staff list, mesma trava dos comandos administrativos existentes)

- `!add list_parceiros <nick>` — adiciona um autor à lista
- `!remove list_parceiros <nick>` — remove um autor da lista
- `!setvalue list_parceiros <valor>` — define o % de voto usado para toda
  a lista (valida número entre 0 e 100), persiste no arquivo de peso
- `!list list_parceiros` — lista os autores cadastrados e o valor de voto
  atual (mesmo padrão de `!blacklist`, `!verified`, `!stafflist`,
  `!autolist`)
- Atualizar o texto de `!help` com os novos comandos

### O que não muda

- Motor de pontuação e fluxo `processPost` da comunidade HiveBR (tag
  `hivebr`/`hive-br`) — intocado.
- `castVoteAndComment` e o handler de clique do botão de voto
  (`interactionCreate`) — reaproveitados sem alteração, já que o
  `customId` segue o mesmo formato `autor/permlink/peso`.
- Comando `!vote autor/permlink valor` — continua como via manual de
  exceção para autores fora da whitelist.

## Casos de borda

- Autor está na whitelist **e** na blacklist → blacklist prevalece, não
  vota.
- Autor da whitelist publica um post com a tag `hivebr` → tratado como
  post normal da comunidade (fluxo de pontuação), não como parceiro.
- Post duplicado ou editado no mesmo dia → bloqueado pela checagem de
  "já votou hoje" já existente.
- Valor inválido em `!setvalue list_parceiros` (não numérico ou fora do
  intervalo 0–100) → comando rejeita e informa o erro, sem persistir.

## Extensões futuras (fora de escopo nesta versão, mas o design não impede)

- Peso de voto configurável por pessoa, não só global para a lista.
- Grupos nomeados de parceria, para múltiplas parcerias com identidades
  visuais e pesos distintos.
- Opção de voto automático por entrada da whitelist (reaproveitando a
  ideia do `auto.json` já existente, mas com uma flag própria por
  autor de parceria).
