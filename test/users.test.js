import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

// La suite usa configuración de prueba y no necesita conectarse a un Samba AD real.
process.env.LDAP_URL = 'ldaps://localhost:636';
process.env.LDAP_BIND_DN = 'CN=test,DC=example,DC=com';
process.env.LDAP_BIND_PASSWORD = 'test-only';
process.env.API_TOKEN = 'test-token-with-more-than-thirty-two-characters';
process.env.LDAP_BASE_DN = 'DC=example,DC=com';
process.env.LDAP_USERS_OU = 'OU=Users,DC=example,DC=com';

const { createApp } = await import('../src/app.js');
// Objeto representativo que devuelve el servicio simulado.
const user = {
  id: '1234', username: 'ana', givenName: 'Ana', surname: 'Perez',
  displayName: 'Ana Perez', email: 'ana@example.com', department: '', title: '', enabled: true
};

let server;
let baseUrl;
let calls;

before(async () => {
  // El doble registra argumentos para verificar el contrato de las rutas.
  const userService = {
    async list(options) {
      calls.list = options;
      return { users: [user], hasMore: false };
    },
    async get(username) {
      calls.get = username;
      return username === user.username ? user : null;
    },
    async create(data) {
      calls.create = data;
      return user;
    },
    async update(username, data) {
      calls.update = { username, data };
      return username === user.username ? user : null;
    },
    async remove(username) {
      calls.remove = username;
      return username === user.username;
    }
  };
  server = createApp({ userService }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

beforeEach(() => {
  calls = {};
});

function apiFetch(path, options = {}) {
  // Añade el token de prueba a las solicitudes protegidas.
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${process.env.API_TOKEN}`);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('health endpoint reports API status', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('protects API routes with a bearer token', async () => {
  const response = await fetch(`${baseUrl}/api/users`);
  assert.equal(response.status, 401);
});

test('lists users with validated pagination', async () => {
  const response = await apiFetch('/api/users?limit=10&offset=5');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls.list, { limit: 10, offset: 5 });
  assert.equal(body.data[0].username, 'ana');
  assert.equal(body.pagination.hasMore, false);
});

test('rejects invalid pagination and usernames', async () => {
  assert.equal((await apiFetch('/api/users?limit=1000')).status, 400);
  assert.equal((await apiFetch('/api/users/ana%2A')).status, 400);
});

test('creates a validated user and returns 201', async () => {
  const response = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'ana', userPrincipalName: 'ana@example.com', password: 'StrongPass123!',
      givenName: 'Ana', surname: 'Perez', displayName: 'Ana Perez', enabled: true
    })
  });
  assert.equal(response.status, 201);
  assert.equal(calls.create.password, 'StrongPass123!');
  assert.equal((await response.json()).data.username, 'ana');
});

test('does not call create for invalid user payloads', async () => {
  const response = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bad name', password: 'short' })
  });
  assert.equal(response.status, 400);
  assert.equal(calls.create, undefined);
});

test('reads a user and returns 404 when absent', async () => {
  assert.equal((await apiFetch('/api/users/ana')).status, 200);
  assert.equal((await apiFetch('/api/users/unknown')).status, 404);
});

test('updates a user and rejects an empty patch', async () => {
  const response = await apiFetch('/api/users/ana', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: false })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.update, { username: 'ana', data: { enabled: false } });
  assert.equal((await apiFetch('/api/users/ana', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
});

test('deletes an existing user and reports a missing one', async () => {
  assert.equal((await apiFetch('/api/users/ana', { method: 'DELETE' })).status, 204);
  assert.equal((await apiFetch('/api/users/unknown', { method: 'DELETE' })).status, 404);
});