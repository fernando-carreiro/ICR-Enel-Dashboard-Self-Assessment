# Dashboard Controles Internos Brasil

## Visão Geral

Dashboard HTML/CSS/JS puro (PowerShell 5.1) para visualização de controles internos, com **3 abas**:

- **Avaliação** – KPIs gerais, filtros por estrutura e status
- **SA1 × Holding** – Comparativo entre unidades
- **Painel SA1** – Detalhamento por controle

## Build & Dados

- **1.197 controles** (906 SA3, 197 SA0, 94 SA1) após aplicação do filtro **`org.dummy*`**,
  conforme a planilha de 09/11/2026.
- Filtro aplicado em `tools/build_dataset.ps1` após o check de `Country`, não na UI.
- Dados gerados por `tools/build.ps1` → `data/dataset.js`.

## Fontes do SharePoint

A **pasta do mês é escolhida automaticamente** pela data do sistema: em novembro ele lê a pasta
de novembro, em dezembro a de dezembro, e assim por diante (ano e semestre também acompanham a
data). Os nomes das pastas não seguem um padrão único no SharePoint, então o mês é identificado
pelo nome — `11. November`, `08.August`, `November` e `Out` são todos reconhecidos.

| Tipo | Pasta pai (fixa) | Pasta do mês atual |
|------|------------------|--------------------|
| **Monitoring** | `01_Year 2026/04_ICR Assessment Process/II SEM 2026/01_Reports/02_Monitoring` | `11. November` |
| **Report Issue** | `01_Year 2026/04_ICR Assessment Process/II SEM 2026/01_Reports/03_Report Issue` | `November` |

- Arquivos em uso hoje: `Monitoring.09_11_2026.xlsx` e `issue Report.09_11_2026.xlsx`.
- Se a pasta do mês corrente ainda não existir (ex.: dia 1º de dezembro), ele usa a do mês
  anterior e avisa no toast: *"A pasta do mês corrente ainda não existe; usei 11. November."*
- Nomes aceitos por mês: inglês e português, completo ou abreviado (`October`, `Out`, `Outubro`).
- Quando clicar em **"Atualizar dados"**, o dashboard rastreia as pastas do mês e, se houver novas
  planilhas, baixa e atualiza as 3 abas. Se já são as mesmas, exibe toast com os nomes dos arquivos.

## Logo

- Substituído pelo **logo multicolor da Enel** (SVG recortado via `getBBox()`, viewBox `193 113 1547 827`, ratio 1.871).
- Arquivo: `assets/enel-brasil.svg` (10.150 bytes).
- Substituí a primeira imagem (verde sólido "enel BRASIL") pela segunda (multicolor verde/amarelo/azul "enel" + "BRASIL").

## Botão Atualizar Dados

- Autentica via Edge com perfil `.cache/sp-edge` (SSO corporativo `fernando.carreiro@enel.com`);
  consultas em modo headless, janela visível só quando é preciso logar.
- Fluxo: `starting` → `checking` → `downloading` → `building` → `updated` (ou `same`).
- Ao detectar planilha nova: baixa para `data/raw/`, atualiza `data/sources.json`, roda
  `tools/build.ps1` e recarrega as 3 abas automaticamente.
- `tools/refresh.ps1 -Month 10` força um mês específico (útil para conferir a troca de pasta).
- Estados visíveis no canto superior direito:
  - `Consultando o SharePoint...` (buscando planilhas)
  - `As planilhas do SharePoint já sao as carregadas (...)` (já estão atualizadas)
  - `Nenhuma atualização pendente.` (sucesso/nenhum novo)

## Rotinas auxiliares (tools/)

| Script | Função |
|--------|--------|
| `tools/build_dataset.ps1` | Filtro ORG.DUMMY, build do dataset (1.197 controles) |
| `tools/build.ps1` | Gera `data/dataset.js` a partir dos XLSXs |
| `tools/refresh.ps1` | CDP + listagem SharePoint + download base64 + build |
| `tools/serve.ps1` | Servidor local (porta 8123) + API `/api/refresh/state` e `/api/refresh` com CORS para o Netlify |
| `tools/pack.ps1` | Monta `dist/` (página + assets + dataset) para publicar no Netlify |
| `tools/sharepoint.js` | Listagem `window.__SP.list`, pastas `window.__SP.folders` e download client-side |

## Filtro ORG.DUMMY

- Linhas com estrutura `org.dummy*` são desconsideradas no build.
- Base final na planilha de 09/11/2026: **1.197 controles**.

## Execução local

**Use o atalho `Abrir Dashboard.cmd`** (duplo clique): ele sobe o servidor local na porta 8123
(se ainda não estiver no ar) e abre `http://127.0.0.1:8123/index.html` no navegador.

O botão **Atualizar dados** só funciona com a página servida por esse servidor. Aberto direto do
disco (`file://`), o botão apenas avisa que é preciso usar o atalho — não há como falar com o
SharePoint sem o servidor local.

```powershell
# Alternativa manual
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8123
```

Se a sessão do SharePoint expirar, o próprio botão abre uma janela do Edge para o login e
continua a atualização sozinho depois que você entrar (não é preciso clicar de novo).

## Publicação no Netlify

O dashboard é estático, então publica em qualquer hospedagem. A pasta de publicação é `dist/`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/pack.ps1
```

`dist/` fica com `index.html`, `assets/`, `data/dataset.js` e `_redirects` (~1,8 MB). Ficam fora
de propósito `tools/`, `data/raw/` (planilhas originais) e `.cache/` (perfil do navegador com a
sessão do SharePoint).

Para publicar: arraste a pasta `dist/` em <https://app.netlify.com/drop>, ou use a CLI
(`npx netlify deploy --dir dist --prod`). O link fica `https://<nome>.netlify.app`.

### O botão Atualizar dados no link publicado

O SharePoint só responde com a **sessão corporativa desta máquina**, então nada hospedado no
Netlify consegue baixar a planilha sozinho. O que a página publicada faz:

1. o botão chama o servidor local (`http://127.0.0.1:8123`) em vez do próprio Netlify;
2. o servidor roda `tools/refresh.ps1` como sempre (checa a pasta do mês, baixa, reconstrói);
3. ao terminar, a página publicada busca o `dataset.js` novo **na máquina** e re-renderiza as três
   abas — sem sair da URL do Netlify e sem precisar republicar.

Regras e limites:

- Precisa do atalho **`Abrir Dashboard.cmd`** rodando na máquina (é ele que sobe o servidor).
  Sem ele o link continua funcionando como painel somente leitura e o botão avisa como ativar.
- Navegadores bloqueiam parte desse acesso: Chrome/Edge podem pedir permissão para acessar
  dispositivos da rede local na primeira vez; Firefox libera `localhost`; Safari bloqueia.
- O servidor aceita chamadas apenas de `*.netlify.app` e de `localhost`. Com domínio próprio,
  rode `tools/serve.ps1 -Port 8123 -AllowOrigin https://dashboard.suaempresa.com`.
- Quem abrir o link em outra máquina vê a última base publicada no `dist/` (o botão só atualiza
  pela máquina que tem a sessão do SharePoint).

## Licença

Projeto interno — Enel Brasil.