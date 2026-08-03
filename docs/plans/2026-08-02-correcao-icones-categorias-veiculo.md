# Correção — Ícone das categorias de veículo e desativação do TukTuk

**Data:** 2026-08-02
**Pedido:** (1) "Moto Rápida" está exibindo ícone de carro — deve exibir moto. (2) Desativar o TukTuk, que não faz parte da frota.

## Causa raiz (confirmada no código)

`Backend/seedTariff.js` cria as três categorias **sem definir `iconKey`**:

```js
{ name: 'moto', displayName: 'Moto Rápida', baseFare: 20, ... }   // sem iconKey
```

E `vehicleCategory.model.js` define `iconKey` com `default: 'car'`. Resultado: **as três categorias ficam gravadas com `iconKey: 'car'`** e o app do passageiro (`VehiclePanel.jsx`, que renderiza `vehicleImages[category.iconKey]`) mostra carro para todas. O mapeamento de imagens em `assets/vehicleAssets.js` está correto (`moto` → `vehicle-moto.png`); o problema é puramente o dado gravado.

## O que muda

1. **`seedTariff.js`**: passa a definir `iconKey` explicitamente em cada categoria (corrige instalações novas) e cria a categoria `auto` já com `isActive: false`.
2. **Novo `scripts/fix-vehicle-categories.js`**: migração idempotente para corrigir o banco que já existe — o seed só cria o que falta (`if (!exists)`), então sozinho não conserta documentos já gravados. Corrige `iconKey` de `moto`/`auto` e desativa `auto`.
3. **`VehiclePanel.jsx`**: fallback defensivo `iconKey` → `name` → `car`, para uma categoria futura sem `iconKey` não voltar a cair silenciosamente em carro.

## Por que `isActive: false` basta para desativar o TukTuk

Verifiquei todos os pontos que consultam categorias — todos já filtram por `isActive: true`:

| Onde | Efeito |
|---|---|
| `vehicleCategory.controller.js` (lista pública) | Some da tela "Escolha um veículo" |
| `ride.service.js: getFare` | Deixa de receber cotação de preço |
| `pricingEngine.service.js` | Recusa cálculo para essa categoria |
| `captain.controller.js: registerCaptain` | Motorista não consegue mais se cadastrar como TukTuk |

Não removo a categoria do banco: corridas históricas referenciam `vehicleType: 'auto'` e apagá-la quebraria relatórios e o histórico. Desativar é reversível pelo próprio painel admin (aba Tarifas), que é o comportamento correto.

## Verificação

- Script de migração rodado contra um banco em memória populado com o estado atual (as três categorias com `iconKey: 'car'`, todas ativas), confirmando o resultado e a idempotência (rodar duas vezes não muda nada na segunda).
- Build do frontend do passageiro.

---

## Detalhes da execução

1. **`Backend/seedTariff.js`**: `iconKey` explícito por categoria (`car`/`moto`/`auto`) e `isActive: false` na categoria `auto`. Corrige instalações novas.
2. **`Backend/scripts/fix-vehicle-categories.js`** (novo): migração idempotente. Corrige `iconKey` de `moto` → `moto` e de `auto` → `auto` + `isActive: false` em documentos já existentes no banco. Não mexe em `car` (já nasce correta) nem apaga nada.
3. **`frontend/src/modules/passenger/components/VehiclePanel.jsx`**: fallback do ícone passou de `vehicleImages[category.iconKey] || vehicleImages.car` para `vehicleImages[category.iconKey] || vehicleImages[category.name] || vehicleImages.car` — uma categoria futura sem `iconKey` cai no ícone pelo próprio `name` antes de cair em carro.

### Verificação feita

- Script de migração testado contra `MongoMemoryReplSet` (mesmo helper usado nos testes de integração, `Backend/tests/setup/testDatabase.js`): banco populado com o estado bugado real (3 categorias, todas com `iconKey: 'car'`, todas `isActive: true`), script executado como processo filho (`node scripts/fix-vehicle-categories.js`) apontando `DB_CONNECT` pro banco em memória.
  - 1ª execução: `moto` → `iconKey: 'moto'`, `auto` → `iconKey: 'auto'` + `isActive: false`, `car` inalterada. Confirmado lendo o banco de volta após a execução.
  - 2ª execução: saída confirma `Categorias atualizadas: 0` — idempotente.
  - Script de verificação era um arquivo solto (`Backend/_verify_fix_vehicle_categories.js`), apagado depois de confirmar os resultados.
- `npm run build` no `frontend`: build passou sem erros (aviso pré-existente de chunk size, não relacionado a esta mudança).

### Pendente (fora do escopo deste código)

O `fix-vehicle-categories.js` ainda precisa ser **rodado manualmente contra o banco real** (dev/produção) para corrigir os documentos já existentes — isso não foi feito nesta sessão, só a verificação em banco de memória. Rodar com `node Backend/scripts/fix-vehicle-categories.js` (usa `DB_CONNECT` do `.env`).

Nada deste trabalho foi commitado — aguardando instrução explícita do usuário, conforme convenção da sessão.
