import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Valida y convierte las variables de entorno al iniciar para fallar pronto si falta configuración.
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LDAP_URL: z.string().url().refine((value) => new URL(value).protocol === 'ldaps:', 'LDAP_URL debe usar ldaps://'),
  LDAP_BIND_DN: z.string().min(1),
  LDAP_BIND_PASSWORD: z.string().min(1),
  API_TOKEN: z.string().min(32),
  LDAP_BASE_DN: z.string().min(1),
  LDAP_USERS_OU: z.string().min(1),
  LDAP_CA_CERT_PATH: z.string().optional().default(''),
  LDAP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  CORS_ORIGIN: z.string().optional().default('*')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // No se imprime ningún valor recibido, ya que podría contener secretos.
  throw new Error(`Configuracion de entorno invalida: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
}

const env = parsed.data;
export const config = {
  ...env,
  // Si se indica una CA privada, Node la usa para verificar el certificado del controlador LDAP.
  ldapTlsOptions: env.LDAP_CA_CERT_PATH ? { ca: [readFileSync(env.LDAP_CA_CERT_PATH)] } : undefined
};

// Compara tokens en tiempo constante para reducir filtraciones por diferencias de tiempo.
export function isValidApiToken(candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = Buffer.from(config.API_TOKEN);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}