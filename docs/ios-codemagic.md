# iOS com Codemagic (plano gratuito)

Configuração em [`codemagic.yaml`](../codemagic.yaml). Corre em Mac M2 do Codemagic (500 min/mês grátis, ~10–15 min por build).

| Workflow | Gatilho | Resultado |
|---|---|---|
| `ios-testflight` | tag `v*` (ex.: `v1.2.0`) | Build → TestFlight + submissão para revisão da App Store (publica sozinha após aprovação). A mesma tag publica o Android em produção (GitHub Actions). |
| `ios-adhoc` | tag `adhoc-*` (ex.: `adhoc-3`) ou manual | `.ipa` Ad Hoc para os iPhones registados. |

Não uses `v1.2.0-adhoc`: isso corresponde a `v*` e publicava o Android em produção.

## Configuração inicial (uma vez)

### 1. Apple (developer.apple.com / App Store Connect)
1. **Identifiers** → registar o App ID `com.ispcfacilmz.app` (se ainda não existir).
2. **App Store Connect → Apps → +** → nova app com esse bundle ID, nome "ISPC Fácil".
3. **App Store Connect → Users and Access → Integrations → App Store Connect API** → gerar chave com acesso **App Manager**. Guardar o `.p8` (só se descarrega uma vez), o **Issuer ID** e o **Key ID**.
4. **TestFlight → Internal Testing** → criar um grupo e adicionar os testadores (têm de ser utilizadores da equipa no App Store Connect). Ativar distribuição automática.

### 2. Codemagic (codemagic.io)
1. Adicionar a app a partir do repositório Git e escolher **codemagic.yaml** como configuração.
2. **Team settings → Integrations → Developer Portal → Connect** → colar Issuer ID, Key ID e o `.p8`. O nome tem de ser exatamente **`ISPC Facil ASC`**.
3. **Team settings → Code signing identities**:
   - **iOS certificates → Generate certificate** → tipo *Apple Distribution* (usa a integração acima). Serve para os dois workflows.
   - **iOS provisioning profiles → Fetch profiles** → importar:
     - perfil **App Store** de `com.ispcfacilmz.app`
     - perfil **Ad Hoc** de `com.ispcfacilmz.app` (criar primeiro no portal Apple, ver abaixo)

### 3. Perfil Ad Hoc e dispositivos
1. developer.apple.com → **Devices → +** → registar o UDID de cada iPhone (máx. 100 por ano). Para obter o UDID: ligar o iPhone ao Finder/iTunes, ou usar um site como udid.tech.
2. **Profiles → +** → *Ad Hoc* → App ID `com.ispcfacilmz.app` → certificado de distribuição → marcar todos os dispositivos.
3. No Codemagic, **Fetch profiles** outra vez.

**Quando registares um iPhone novo:** edita o perfil Ad Hoc no portal Apple para incluir o novo dispositivo, guarda, faz *Fetch profiles* no Codemagic e lança uma build nova.

## Utilização

```bash
# Release (TestFlight + Android produção)
git tag v1.2.0 && git push origin v1.2.0

# .ipa para instalar diretamente
git tag adhoc-1 && git push origin adhoc-1
```

- **TestFlight:** depois do processamento da Apple (~5–30 min), os testadores instalam pela app TestFlight.
- **Ad Hoc:** descarregar o `.ipa` em *Artifacts* na build do Codemagic (o link também chega por email). Para instalar no iPhone: enviar o `.ipa` para diawi.com e abrir o link no Safari do iPhone, ou arrastar o ficheiro para o iPhone ligado ao Finder/Apple Configurator.

## Versões
- `CFBundleShortVersionString` = tag sem o `v` (ou `version` do `package.json` nas builds Ad Hoc).
- `CFBundleVersion` = número de build do Codemagic + 100 (sempre a crescer).

## Submissão à App Store
Cada tag `v*` cria a versão no App Store Connect, associa a build e submete para revisão (`submit_to_app_store: true`, `release_type: AFTER_APPROVAL`).

A API da Apple não cria a app nem preenche a ficha. **Antes da primeira tag `v*`**, preencher à mão no App Store Connect:
- **App Information:** categoria (Business / Finance), classificação etária, URL da política de privacidade.
- **Pricing and Availability:** grátis, países (Moçambique, …).
- **App Privacy:** questionário de dados recolhidos (email, nome, dados financeiros/faturação ligados ao utilizador, sem tracking).
- **Versão 1.0 (página "Prepare for Submission"):** screenshots iPhone 6,9" (1320×2868) e iPad 13" (2064×2752) se suportar iPad, descrição, palavras-chave, URL de suporte.
- **App Review Information:** contacto e **conta de demonstração** (email + palavra-passe com dados de exemplo) — sem isto a Apple rejeita, porque a app exige login.

Se faltar algum destes campos, a build chega ao TestFlight mas a submissão falha (o email do Codemagic indica o campo em falta). Corrige no App Store Connect e volta a lançar a build no Codemagic.

A Apple exige eliminação de conta dentro da app (já existe) e rejeita apps que parecem um site embrulhado — garantir que a experiência nativa (POS, navegação) está polida antes da primeira submissão.
