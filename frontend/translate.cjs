const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const dictionary = {
  // Start.jsx
  "Get Started with Uber": "Começar a usar o Uber",
  "Continue": "Continuar",
  // Login / Signup (User & Captain)
  "What's your email": "Qual é o seu email?",
  "email@example.com": "email@exemplo.com",
  "Enter Password": "Senha",
  "password": "senha",
  "Login": "Entrar",
  "New here?": "Novo por aqui?",
  "Create new Account": "Criar uma conta",
  "Sign in as Captain": "Entrar como Motorista",
  "What's your name": "Qual é o seu nome?",
  "First name": "Nome",
  "Last name": "Sobrenome",
  "Create account": "Criar conta",
  "Already have a account?": "Já tem uma conta?",
  "Login here": "Faça login aqui",
  "Sign in as User": "Entrar como Passageiro",
  "This site is protected by reCAPTCHA": "Este site é protegido pelo reCAPTCHA",
  "Register as a Captain": "Cadastre-se como Motorista",
  "Vehicle Information": "Informações do Veículo",
  "Vehicle Color": "Cor do Veículo",
  "Vehicle Plate": "Placa do Veículo",
  "Vehicle Capacity": "Capacidade de Passageiros",
  "Vehicle Type": "Tipo de Veículo",
  "Select Vehicle Type": "Selecione o Tipo de Veículo",
  "Car": "Carro",
  "Auto": "Triciclo/Auto",
  "Moto": "Moto",
  "Invalid email or password": "Email ou senha inválidos",
  "Welcome back": "Bem-vindo de volta",
  "Account created successfully": "Conta criada com sucesso",
  "Registration failed": "Falha no cadastro",
  // Home / Ride panels
  "Find a trip": "Encontre uma viagem",
  "Add a pick-up location": "Local de partida",
  "Enter your destination": "Para onde você vai?",
  "Choose a Vehicle": "Escolha um Veículo",
  "Confirm PopUp": "Confirmar",
  "Confirm": "Confirmar",
  "Cancel": "Cancelar",
  "Cash": "Dinheiro",
  "Card": "Cartão",
  "UPI": "Pix/UPI",
  "Looking for nearby drivers": "Procurando motoristas próximos...",
  "Meet at the pickup point": "Encontre o motorista no local",
  "Make a Payment": "Fazer Pagamento",
  "Complete Ride": "Finalizar Corrida",
  "Finish Ride": "Finalizar Corrida",
  "Enter OTP": "Código OTP",
  "Confirm Ride": "Confirmar Corrida",
  "Accept": "Aceitar",
  "Ignore": "Ignorar",
  "New Ride Available!": "Nova Corrida Disponível!",
  "Drop Off": "Destino",
  "Pick Up": "Origem",
  "Distance": "Distância",
  "Time": "Tempo",
  "mins": "min",
  "Total Fare": "Valor Total",
  "Waiting for Driver": "Aguardando o Motorista",
  "Driver is on the way": "O motorista está a caminho",
  "Vehicle Details": "Detalhes do Veículo",
  "Message": "Mensagem",
  "Call": "Ligar",
  "Pay": "Pagar",
  "Payment": "Pagamento",
  "Completed": "Concluído"
};

function processDirectory(directory) {
  const files = fs.readdirSync(directory);
  files.forEach(file => {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      for (const [eng, pt] of Object.entries(dictionary)) {
        // Regex para capturar o texto inglês mantendo o que estiver em volta
        const regex = new RegExp(`>\\s*${eng}\\s*<`, 'g');
        if (regex.test(content)) {
          content = content.replace(regex, `>${pt}<`);
          changed = true;
        }
        
        const regexQuotes = new RegExp(`'${eng}'`, 'g');
        if (regexQuotes.test(content)) {
          content = content.replace(regexQuotes, `'${pt}'`);
          changed = true;
        }

        const regexDoubleQuotes = new RegExp(`"${eng}"`, 'g');
        if (regexDoubleQuotes.test(content)) {
          content = content.replace(regexDoubleQuotes, `"${pt}"`);
          changed = true;
        }

        const regexPlaceholder = new RegExp(`placeholder=['"]${eng}['"]`, 'g');
        if (regexPlaceholder.test(content)) {
          content = content.replace(regexPlaceholder, `placeholder="${pt}"`);
          changed = true;
        }
      }

      // Casos específicos que a regex genérica não pega perfeitamente
      if (content.includes("What's your email")) {
        content = content.replace(/What's your email/g, "Qual é o seu email?");
        changed = true;
      }
      if (content.includes("Enter Password")) {
        content = content.replace(/Enter Password/g, "Senha");
        changed = true;
      }
      if (content.includes("Sign in as Captain")) {
        content = content.replace(/Sign in as Captain/g, "Entrar como Motorista");
        changed = true;
      }
      if (content.includes("New here?")) {
        content = content.replace(/New here\?/g, "Novo por aqui?");
        changed = true;
      }
      if (content.includes("Create new Account")) {
        content = content.replace(/Create new Account/g, "Criar uma conta");
        changed = true;
      }
      if (content.includes("What's your name")) {
        content = content.replace(/What's your name/g, "Qual é o seu nome?");
        changed = true;
      }
      if (content.includes("Already have a account?")) {
        content = content.replace(/Already have a account\?/g, "Já tem uma conta?");
        changed = true;
      }
      if (content.includes("Login here")) {
        content = content.replace(/Login here/g, "Faça login aqui");
        changed = true;
      }
      if (content.includes("Sign in as User")) {
        content = content.replace(/Sign in as User/g, "Entrar como Passageiro");
        changed = true;
      }
      if (content.includes("Register as a Captain")) {
        content = content.replace(/Register as a Captain/g, "Cadastre-se como Motorista");
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Translated: ${file}`);
      }
    }
  });
}

processDirectory(srcDir);
console.log('Translation complete.');
