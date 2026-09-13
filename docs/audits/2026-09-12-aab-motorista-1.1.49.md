# AAB MoveCity Motorista 1.1.49 (51)

Gerado localmente em 12/09/2026. Pacote `br.com.movecity.driver`, variante `playRelease`, Java 21. Build concluído com `BUILD SUCCESSFUL`.

Arquivo para entrega: `C:/Users/Pichau/Downloads/movecity-motorista-1.1.49-51.aab`.

Saída original: `frontend/android/app/build/outputs/bundle/playRelease/app-play-release.aab`.

Tamanho: **10.331.693 bytes**. A cópia em Downloads tem o mesmo SHA-256 da saída original:

```text
9cc3f706f803286c325647f8673cbdabcc6693001514feafbd982186950f7c3f
```

O arquivo `.aab.sha256` em Downloads acompanha a entrega.

Mudanças: correção da origem no login nativo, nome opcional na corrida presencial, carteira e extrato separados por conta, logout com espera limitada, recuperação do cadastro e da foto, nova tentativa das categorias, contato de recarga consistente e janela de recarga com rolagem. Detalhes e testes em [Melhorias do aplicativo](2026-09-12-melhorias-proximo-aab-motorista.md).

## Verificação do artefato

- `bundletool 1.18.3 validate`: aprovado.
- Manifesto extraído pelo bundletool: pacote, versão 1.1.49 e código 51 conferidos; aplicação sem modo de depuração.
- Permissões exclusivas do canal externo ausentes: instalação de pacotes, alarmes exatos, full-screen intent, dispensa direta de otimização de bateria e desativação do bloqueio de tela.
- `jarsigner -verify`: `jar verified`. Certificado de release MoveCity; não é Android Debug. Avisos do jarsigner relativos ao certificado autoassinado e à ausência de timestamp não invalidaram a verificação.
- SHA-256 do certificado: `15:26:B6:15:8B:04:F0:AF:45:0D:D5:BA:92:A1:A9:5D:36:9C:F8:05:B1:EF:69:77:0E:DD:82:24:E1:B5:1B:4B`.
- 32 arquivos JS/CSS dentro do AAB comparados por SHA-256 com o build web validado: todos iguais. Sem fixtures E2E ou arquivos `.env` dentro do pacote.
- Configuração de push nativo e URL HTTPS da API aprovadas pelos scripts do projeto.
- Regressões: 708 testes do frontend, 37 do backend e 18 de navegação/layout aprovados. Após o ajuste final da janela, os 5 testes da carteira também foram executados e aprovados.

## Distribuição

O AAB está gerado e assinado, **sem publicação na Play Store**. O backend deve receber as alterações de `passengerName` antes de distribuir o aplicativo para que os nomes de corridas presenciais sejam persistidos e retornados. Não houve implantação do servidor nesta tarefa.

Não foi feita instalação ou corrida em aparelho físico. A validação visual foi realizada no Chromium com dados fictícios.
