import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('http://localhost:3000/api/admin/login', async ({ request }) => {
    const body = await request.json();
    
    if (body.email === 'test@test.com' && body.password === 'correct123') {
      return HttpResponse.json({
        token: 'fake-jwt-token-123',
        refreshToken: 'fake-refresh-token-123',
        admin: { _id: '1', name: 'Admin Test', role: 'super_admin' }
      });
    }

    return HttpResponse.json(
      { message: 'Credenciais inválidas' },
      { status: 401 }
    );
  }),

  http.get('http://localhost:3000/api/admin/dashboard', () => {
    return HttpResponse.json({
      revenue: 5000,
      totalUsers: 100,
      totalDrivers: 50,
      activeRides: 5
    });
  }),
];
