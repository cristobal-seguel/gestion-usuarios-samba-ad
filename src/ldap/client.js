import { Client } from 'ldapts';
import { config } from '../config.js';

export function createLdapClient() {
  return new Client({
    url: config.LDAP_URL,
    timeout: config.LDAP_TIMEOUT_MS,
    connectTimeout: config.LDAP_TIMEOUT_MS,
    tlsOptions: config.ldapTlsOptions
  });
}

export async function withLdapClient(operation) {
  const client = createLdapClient();
  try {
    await client.bind(config.LDAP_BIND_DN, config.LDAP_BIND_PASSWORD);
    return await operation(client);
  } finally {
    await client.unbind().catch(() => {});
  }
}