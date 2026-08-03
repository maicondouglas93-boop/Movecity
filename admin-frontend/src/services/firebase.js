// Fase 7 da correção do sistema de push (2026-08-02): canal de push para o painel
// administrativo. Mesmo projeto Firebase do app do passageiro/motorista — cada origem
// (este painel roda num domínio próprio) precisa da própria inicialização e do próprio
// Service Worker, mas o projeto e as credenciais públicas são os mesmos.
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
