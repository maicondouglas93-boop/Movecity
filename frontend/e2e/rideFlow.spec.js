import { test, expect } from '@playwright/test';

test.describe('Ride Flow End-to-End', () => {
  // Configured to point to the frontend preview or dev URL
  const baseURL = 'http://localhost:5173';

  test('Passenger can login, request a ride and see matching driver', async ({ browser }) => {
    // We create two contexts for Passenger and Captain
    const passengerContext = await browser.newContext();
    const captainContext = await browser.newContext();

    const passengerPage = await passengerContext.newPage();
    const captainPage = await captainContext.newPage();

    // -- 1. Captain Log In --
    await captainPage.goto(`${baseURL}/captain-login`);
    // Assuming a seeded captain is available in DB or via mock for E2E
    await captainPage.fill('input[type="email"]', 'captain_e2e@test.com');
    await captainPage.fill('input[type="password"]', 'password123');
    await captainPage.click('button:has-text("Entrar")');
    await captainPage.waitForURL(`${baseURL}/captain-home`);
    
    // Captain goes online
    // Check if the offline button is visible, click it to go online
    // (We will assume CaptainHome has an online/offline toggle)
    const toggleButton = captainPage.locator('button:has-text("Offline"), button:has-text("Online")');
    const text = await toggleButton.innerText();
    if (text.includes('Offline')) {
        await toggleButton.click(); // go online
    }

    // -- 2. Passenger Log In --
    await passengerPage.goto(`${baseURL}/login`);
    await passengerPage.fill('input[type="email"]', 'user_e2e@test.com');
    await passengerPage.fill('input[type="password"]', 'password123');
    await passengerPage.click('button:has-text("Entrar")');
    await passengerPage.waitForURL(`${baseURL}/home`);

    // -- 3. Passenger Requests Ride --
    // Open destination search
    await passengerPage.click('text="Buscar destino"');
    
    await passengerPage.fill('input[placeholder="Local de partida"]', 'Avenida Paulista, 1000');
    // We assume some auto-suggestion logic is mocked or handles simple input 
    await passengerPage.waitForTimeout(500);

    await passengerPage.fill('input[placeholder="Para onde você vai?"]', 'Avenida Faria Lima, 2000');
    await passengerPage.waitForTimeout(500);

    await passengerPage.click('button:has-text("Buscar Corrida")');

    // Select car type
    await passengerPage.click('text="Confirmar Escolha"'); // Assume vehicle type 'car' is default and panel shows 'Confirmar Escolha'

    // Confirm Ride
    await passengerPage.click('button:has-text("Confirmar Corrida")');

    // -- 4. Captain Receives Ride Request --
    // Captain should see a popup for the new ride
    await expect(captainPage.locator('text="Nova Corrida"')).toBeVisible({ timeout: 15000 });
    await captainPage.click('button:has-text("Aceitar")');

    // -- 5. Passenger Sees Driver details & OTP --
    await expect(passengerPage.locator('text="Motorista encontrado!"')).toBeVisible({ timeout: 15000 });
    
    // OTP will be visible somewhere in the passenger's waiting panel
    const otpElement = await passengerPage.locator('text=/OTP: \\d{4}/').first();
    const otpText = await otpElement.innerText();
    const otpMatch = otpText.match(/OTP: (\d{4})/);
    expect(otpMatch).not.toBeNull();
    const otp = otpMatch[1];

    // -- 6. Captain Completes Flow --
    await captainPage.click('button:has-text("Cheguei")'); // Arrival
    await expect(captainPage.locator('input[placeholder="OTP"]')).toBeVisible();
    await captainPage.fill('input[placeholder="OTP"]', otp);
    await captainPage.click('button:has-text("Iniciar Viagem")');

    // Finish Ride
    await captainPage.click('button:has-text("Finalizar Viagem")');
    await expect(captainPage.locator('text="Pagamento Finalizado"')).toBeVisible();

    await passengerContext.close();
    await captainContext.close();
  });
});
