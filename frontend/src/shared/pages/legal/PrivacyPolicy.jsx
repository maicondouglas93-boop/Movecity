/* eslint-disable react/prop-types */
import LegalPage from './LegalPage'

const Section = ({ title, children }) => (
  <section className="mb-7 last:mb-0">
    <h2 className="text-lg font-bold mb-2">{title}</h2>
    <div className="text-sm leading-6 text-ink-600 space-y-3">{children}</div>
  </section>
)

const PrivacyPolicy = () => (
  <LegalPage title="Política de Privacidade">
    <p className="text-sm text-ink-600 leading-6 mb-7">
      Esta política explica como o MoveCity, serviço operado por Maicon Doglas de Oliveira Souza, em Lajinha–MG, trata dados pessoais de passageiros e motoristas parceiros.
    </p>
    <Section title="1. Dados tratados">
      <p>Podemos tratar nome, e-mail, telefone, CPF, data de nascimento, foto de perfil e dados de cadastro.</p>
      <p>Para motoristas, também são tratados dados do veículo, CNH, CRLV, selfie de verificação, chave PIX e dados necessários a repasses.</p>
      <p>Durante o uso do serviço, tratamos localização, endereços de embarque e destino, dados de corridas e encomendas, mensagens, avaliações, registros de segurança, aparelho e notificações.</p>
    </Section>
    <Section title="2. Para que usamos os dados">
      <p>Usamos os dados para criar e proteger contas, conectar passageiros e motoristas, calcular rotas e valores, executar corridas e entregas, processar pagamentos e repasses, prestar suporte, prevenir fraude e cumprir obrigações aplicáveis.</p>
    </Section>
    <Section title="3. Localização">
      <p>A localização do passageiro é usada para selecionar embarque, acompanhar serviços ativos, estimar rota e preço e oferecer recursos de segurança.</p>
      <p>No app do motorista, a localização pode continuar sendo coletada em segundo plano quando ele está online ou em serviço ativo, inclusive para despacho, acompanhamento e cálculo da corrida. O motorista pode interromper essa coleta ficando offline, encerrando o serviço e retirando a permissão nas configurações do aparelho.</p>
    </Section>
    <Section title="4. Compartilhamento">
      <p>Compartilhamos os dados necessários entre passageiro e motorista para executar o serviço, como nome, localização de embarque/destino e informações do veículo.</p>
      <p>Também podemos usar fornecedores de infraestrutura, mapas, armazenamento, notificações, monitoramento e pagamentos. Eles recebem somente os dados necessários à atividade contratada e devem protegê-los.</p>
      <p>Dados também podem ser apresentados a autoridades quando houver obrigação legal ou ordem válida.</p>
    </Section>
    <Section title="5. Segurança e conservação">
      <p>Aplicamos controles de acesso, sessões revogáveis, comunicação protegida e restrição de acesso a documentos. Nenhum sistema, porém, elimina totalmente os riscos.</p>
      <p>Após uma solicitação autenticada de exclusão, o acesso à conta é desativado imediatamente. Os dados pessoais são apagados ou anonimizados em até 30 dias, salvo quando a conservação for necessária para segurança, prevenção a fraude, resolução de disputas ou cumprimento de obrigação legal.</p>
    </Section>
    <Section title="6. Seus direitos e exclusão">
      <p>Você pode pedir acesso, correção ou exclusão dos seus dados pelos canais de suporte. A exclusão também pode ser solicitada dentro do aplicativo ou na página pública “Excluir conta”.</p>
      <p>Uma solicitação pode precisar de verificação de identidade e não será concluída enquanto houver corrida ou encomenda ativa.</p>
    </Section>
    <Section title="7. Contato">
      <p>E-mail: <a className="text-brand-700 font-semibold" href="mailto:maicondouglas93@gmail.com">maicondouglas93@gmail.com</a></p>
      <p>WhatsApp: <a className="text-brand-700 font-semibold" href="https://wa.me/5533998680141">+55 33 99868-0141</a></p>
    </Section>
    <p className="text-xs text-ink-400 mt-8">Última atualização: 12 de agosto de 2026.</p>
  </LegalPage>
)

export default PrivacyPolicy
