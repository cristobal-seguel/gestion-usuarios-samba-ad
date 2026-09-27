# API de usuarios para Samba AD

API REST con Node.js, Express y LDAP para crear, consultar, modificar y eliminar usuarios de Samba Active Directory. La API usa LDAPS y una cuenta de servicio, y protege los endpoints CRUD con un token Bearer.

## Requisitos

- Node.js 20 o superior.
- Samba AD accesible desde el servidor de la API, preferentemente mediante LDAPS (TCP 636).
- Una cuenta de servicio delegada con permisos solo sobre la OU administrada: leer usuarios, crear, modificar atributos y eliminar usuarios. No usar una cuenta Domain Admin.

## Instalación y ejecución

```bash
npm install
cp .env.example .env
```

Edita `.env` con el FQDN, DN de la cuenta de servicio, DN de dominio y OU real. Si el certificado LDAPS está firmado por una CA privada, configura `LDAP_CA_CERT_PATH` con la ruta al certificado de esa CA. No desactives la validación TLS en producción.

```bash
npm run dev
```

La API queda en `http://localhost:3000`; `GET /health` comprueba que el proceso está activo, no que el controlador de dominio sea alcanzable. Para iniciar en modo normal, usa `npm start`. Ejecuta `npm test` para los tests HTTP aislados y `npm run check` para validar sintaxis.

## Configuración

| Variable | Descripción |
| --- | --- |
| `PORT` | Puerto HTTP (por defecto `3000`). |
| `LDAP_URL` | URL LDAPS (`ldaps://host:636`); el transporte cifrado es obligatorio. |
| `LDAP_BIND_DN` | DN de la cuenta de servicio. |
| `LDAP_BIND_PASSWORD` | Contraseña de la cuenta de servicio. Mantener fuera del control de versiones. |
| `API_TOKEN` | Secreto Bearer de al menos 32 caracteres para todas las rutas `/api`. |
| `LDAP_BASE_DN` | DN base del dominio, por ejemplo `DC=empresa,DC=local`. |
| `LDAP_USERS_OU` | OU donde la API buscará y creará usuarios. |
| `LDAP_CA_CERT_PATH` | Ruta opcional a certificado PEM de la CA que firma LDAPS. |
| `LDAP_TIMEOUT_MS` | Timeout de conexión y operaciones LDAP. |
| `CORS_ORIGIN` | Origen frontend permitido; en producción define el origen exacto. |

## Endpoints

Todas las rutas de usuarios se encuentran bajo `/api/users`. Los campos retornados nunca incluyen la contraseña ni atributos de credenciales.

| Método | Ruta | Acción |
| --- | --- | --- |
| `GET` | `/health` | Estado del proceso. |
| `GET` | `/api/users?limit=25&offset=0` | Lista usuarios paginados; `limit` máximo 100. |
| `GET` | `/api/users/:username` | Obtiene un usuario por `sAMAccountName`. |
| `POST` | `/api/users` | Crea usuario. Requiere `username`, `userPrincipalName`, `password`, `givenName`, `surname` y `displayName`; `email`, `department`, `title` y `enabled` son opcionales. |
| `PATCH` | `/api/users/:username` | Cambia `password`, nombres, correo, departamento, cargo o estado `enabled`. |
| `DELETE` | `/api/users/:username` | Elimina al usuario. |

Los errores usan JSON `{ "error": "..." }`; códigos habituales: `400` validación, `401` token inválido, `404` no existe, `409` nombre duplicado y `500` error interno. La lista responde `{ "data": [...], "pagination": { "limit", "offset", "hasMore" } }`.

Ejemplo de alta:

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'authorization: Bearer replace-with-your-api-token' \
  -H 'content-type: application/json' \
  -d '{
    "username": "ana.perez",
    "userPrincipalName": "ana.perez@empresa.local",
    "password": "CambiarEstaClave123!",
    "givenName": "Ana",
    "surname": "Perez",
    "displayName": "Ana Perez",
    "email": "ana.perez@empresa.local",
    "enabled": true
  }'
```

## Seguridad y comportamiento AD

- `unicodePwd` se envía como bytes UTF-16LE con comillas, únicamente sobre LDAPS. La cuenta debe tener permisos para cambiar contraseñas y la clave debe cumplir la política del dominio.
- Usuarios habilitados se crean con `userAccountControl=512`; la actualización de estado preserva los demás bits del atributo.
- Los filtros LDAP escapan valores; la entrada no puede elegir DN ni OU. El nombre de usuario se limita a caracteres seguros y se usa como RDN bajo `LDAP_USERS_OU`.
- Limita `LDAP_USERS_OU` al mínimo privilegio, restringe el acceso de red y guarda los secretos en un gestor de secretos. El token compartido no sustituye autorización por usuario final; en despliegues multiusuario, valida identidades y permisos en un proxy o proveedor de identidad.
- La lista usa paginación LDAP y se detiene tras encontrar el tramo solicitado y un elemento adicional para calcular `hasMore`.