import { Client } from 'ldapts';
import { config } from '../config.js';

// Construye un cliente con LDAPS, los límites de tiempo y la CA opcional configurada.
export function createLdapClient() {
  return new Client({
    url: config.LDAP_URL,
    timeout: config.LDAP_TIMEOUT_MS,
    connectTimeout: config.LDAP_TIMEOUT_MS,
    tlsOptions: config.ldapTlsOptions
  });
}

// Cada operación usa una conexión autenticada y la libera incluso si ocurre un error.
export async function withLdapClient(operation) {
  const client = createLdapClient();
  try {
    await client.bind(config.LDAP_BIND_DN, config.LDAP_BIND_PASSWORD);
    return await operation(client);
  } finally {
    await client.unbind().catch(() => {});
  }
}