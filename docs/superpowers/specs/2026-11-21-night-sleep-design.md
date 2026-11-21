# Modo "dormir" noturno para reduzir custo no Railway

## Contexto / Por quê

O bot custa ~US$1,57 por ciclo no Railway, e 81% disso (US$1,27) é RAM.
O Railway cobra a memória durante todo o tempo em que o processo está vivo
(~120–150 MB, 24h). CPU é irrelevante (US$0,02), então só economiza
**desligar o processo** ou **usar menos RAM**. O objetivo é deixar este bot o
mais barato possível sem prejudicar a curadoria. O Hive Grove fica fora deste
trabalho.

Dados (HafSQL, votos do `hive-br.voter` em 60 dias e posts #hivebr em 30 dias,
horário de Brasília):

- A staff clica em VOTE principalmente entre 22h e 01h (~55% dos votos).
- Entre 02h e 09h: ~1 post por dia e 8 votos em 60 dias (só automáticos).
- O fim de semana não é mais calmo (92–106 votos em qualquer dia da semana).

Já existe um modo noturno (`QUIET_HOURS`, commit 3506d7a) que encerra o
processo e depende do Cron do Railway para religar. A documentação do
Railway diz que o cron não serve para bots de Discord, e não está claro se ele
reinicia o bot depois de um crash ou o que acontece num deploy. Esse modo
nunca foi ativado.

## Objetivos

- Bot dormindo das 02h às 09h (Brasília), sem cobrança de RAM nesse período
  (~29% do custo de RAM).
- Durante o dia, o bot funciona exatamente como hoje, inclusive reiniciando
  sozinho após crash e subindo normalmente após deploy.
- Posts publicados durante a noite são processados na volta (retomada pelo
  `BLOCK_FILE`, como já acontece hoje).
- Diagnóstico para as duas frentes que ainda não dá para atacar sem dados:
  a RAM de produção (~150 MB contra ~75 MB medidos localmente) e o volume
  (1,2–1,4 GB contra poucos KB de arquivos do bot).

## Fora do escopo

- Horário diferente no fim de semana (os dados não justificam).
- Flags de memória do Node: no teste local, baixaram de 77 MB para 74 MB.
  A decisão fica para depois dos logs de memória de produção.
- Trocar o Discord por slash commands via HTTP ("bot por demanda").
- Hive Grove.

## Anti-objetivos

- Qualquer cenário em que o bot fique dormindo durante o dia sem ninguém
  perceber.
- Perder posts.
- Expor um endereço público na internet.

## Abordagens consideradas

| | Como | Por que não / por que sim |
|---|---|---|
| A. Cron do Railway (já pronto) | Encerra às 02h, o Cron religa às 09h | Railway desaconselha cron para bots; comportamento em crash/deploy incerto |
| **B. Serverless + despertador (escolhida)** | Às 02h o bot fica em silêncio, o Railway o põe para dormir; um despertador acorda às 09h | De dia é um serviço normal; só a noite muda |
| C. Não desligar | Só diagnósticos | Sem risco, mas sem a economia noturna |

Escolha do usuário: **B**.

## Desenho

### Estados do bot

- **Acordado:** como hoje (Discord conectado, stream de blocos rodando).
- **Dormindo (silêncio):** nenhum tráfego de rede de saída: sem Discord,
  sem stream, sem logs periódicos. Só um servidor HTTP mínimo escutando. O pool
  do Postgres fecha as conexões ociosas sozinho (`idleTimeoutMillis: 30000`).
  Depois de 5–10 min sem tráfego de saída, o Railway (Serverless) põe o
  serviço para dormir e para de cobrar.

### Transições

1. **Boot dentro da janela** (deploy à noite, ou acordado por engano): entra
   direto em silêncio, sem logar no Discord nem iniciar o stream.
2. **Início da janela (02h) com o bot acordado:** avisa no canal do Discord,
   para o stream de verdade, espera os blocos em andamento (até 60s, como hoje),
   desconecta o Discord e entra em silêncio.
3. **Fim da janela:** o despertador faz uma requisição HTTP e o Railway
   sobe o processo do zero (cold boot). Como está fora da janela, o bot inicia
   normalmente e retoma do `BLOCK_FILE`.
4. **Salvaguarda:** se o processo ainda estiver vivo em silêncio quando a
   janela acabar (o Railway não o pôs para dormir, ou o "acordar" foi um resume
   em vez de cold boot), ele encerra (`process.exit(0)`) e o Railway o reinicia
   do zero. Isso dispara tanto pela requisição HTTP fora da janela quanto por um
   timer marcado para o fim da janela.

### Peças

- **`QUIET_HOURS=02-09`**: mesma variável e mesmo formato de hoje.
- **Servidor HTTP** (módulo `http` nativo, sem dependência nova): sobe só
  quando `QUIET_HOURS` está definido. Escuta em `process.env.PORT || 8080`
  no host `::` (a rede privada do Railway exige IPv6 em ambientes antigos).
  Responde 200 com o estado ("acordado" / "dormindo até 09h"). **Sem domínio
  público**: o acesso é só pela rede privada do projeto.
- **Despertador:** novo serviço no mesmo projeto Railway, imagem
  `curlimages/curl`, Cron Schedule `0,15,30 12 * * *` (09h00, 09h15 e 09h30
  de Brasília), comando
  `curl -fsS --retry 5 --retry-delay 10 --retry-all-errors --max-time 120 http://<servico-do-bot>.railway.internal:8080/`.
  Ele roda alguns segundos e termina, que é o uso para o qual o Cron do
  Railway foi feito, e custa praticamente zero.
  *Decisão minha:* troquei o GitHub Actions combinado antes por esse serviço.
  O repositório é público, e o GitHub desativa agendamentos de repositórios
  públicos após 60 dias sem commits. Além disso, o GitHub exigiria expor o bot
  em um domínio público.
- **`railway.json`:** `restartPolicyType: "ALWAYS"`, para que o
  `process.exit(0)` da salvaguarda e qualquer crash reiniciem o bot.
- **Parar o stream de verdade:** hoje `!stop` e a reconexão só chamam
  `stream.removeAllListeners()`. O stream do dhive é um `PassThrough` em modo
  fluindo e continua buscando blocos a cada 3s em segundo plano. Um helper
  `stopBlockStream()` (remove os listeners **e** destrói o stream) passa a ser
  usado no `!stop`, na reconexão e na entrada em silêncio. Sem isso o Railway
  nunca põe o bot para dormir.
- **Remoção do modo cron antigo:** sai `cronScheduleForWakeUp` e o
  `process.exit` no boot dentro da janela. O `.env.example` passa a explicar o
  modo novo.

### Diagnósticos (temporários)

- **Memória:** uma linha de log no boot e a cada 30 min enquanto acordado,
  com `rss`, `heapUsed`, `heapTotal` e `external` em MB.
- **Volume:** no boot, uma linha com o espaço usado do volume (`fs.statfs`) e
  o tamanho de cada item de `DATA_DIR` (subpastas somadas), para descobrir o
  que ocupa 1,2 GB.

## Configuração no Railway (passo a passo)

Siga nesta ordem. Até o passo 5 o bot se comporta exatamente como hoje.

1. **Deploy do código** com `QUIET_HOURS` vazio. Sem essa variável não sobe
   servidor HTTP e o bot não dorme.
2. **No serviço do bot → Settings:**
   - ative **Serverless**. Com tráfego constante para o Discord e a Hive, ele
     não dorme de dia;
   - em **Cron Schedule**, apague o agendamento se houver um;
   - em **Networking → Private Networking**, anote o nome interno, no
     formato `<nome>.railway.internal`.
3. **No serviço do bot → Variables:** adicione `PORT=8080`.
4. **Crie o despertador:** no projeto, **+ New → Docker Image →
   `curlimages/curl`**. Depois, em Settings:
   - **Cron Schedule:** `0,15,30 12 * * *` (09h00, 09h15 e 09h30 de Brasília;
     o Railway usa UTC);
   - **Custom Start Command:**
     `curl -fsS --retry 5 --retry-delay 10 --retry-all-errors --max-time 120 http://<nome>.railway.internal:8080/`
     (troque `<nome>` pelo nome anotado no passo 2).
5. **Só agora,** no serviço do bot, defina `QUIET_HOURS=02-09`. O Railway
   reinicia o bot. Se for de dia, ele sobe normalmente e avisa no log
   "Quiet hours enabled … Going to sleep in N minutes".
6. Acompanhe a primeira noite com a lista de "Validação depois do deploy"
   abaixo.

**Para acordar o bot fora de hora** (por exemplo, para votar de madrugada):
apague `QUIET_HOURS`. O Railway reinicia o serviço, e ele fica acordado 24h
até a variável voltar.

## Validação depois do deploy

- Às 02h: aviso no Discord, log "dormindo", e o serviço aparece como
  *Sleeping* no Railway em até ~10 min.
- Às 09h: log de sucesso do despertador, boot do bot com
  "Resuming from block …" e posts da madrugada aparecendo no canal.
- No dia seguinte, o gráfico de RAM mostra um buraco de ~7h.
- **Reversão:** apagar `QUIET_HOURS`. Com tráfego constante, o Serverless
  nunca põe o bot para dormir.

## Fica para quem implementar

- Como testar as funções puras de horário (o projeto não tem testes hoje).
- Verificar com um teste local que, depois de `stopBlockStream()`, nenhuma
  nova requisição `get_block` é feita.
