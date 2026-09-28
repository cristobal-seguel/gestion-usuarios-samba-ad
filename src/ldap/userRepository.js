import { Attribute, Change } from 'ldapts';
import { config } from '../config.js';
import { withLdapClient } from './client.js';

const USER_ATTRIBUTES = [
  'sAMAccountName', 'givenName', 'sn', 'displayName', 'mail', 'department', 'title',
  'userAccountControl', 'objectGUID'
];

// LDAP puede entregar un atributo como valor único o como arreglo.
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

// Expone solo los campos permitidos por la API; nunca incluye atributos de contraseña.
function mapEntry(entry) {
  return {
    id: Buffer.isBuffer(entry.objectGUID) ? entry.objectGUID.toString('hex') : String(first(entry.objectGUID) ?? ''),
    username: String(first(entry.sAMAccountName) ?? ''),
    givenName: String(first(entry.givenName) ?? ''),
    surname: String(first(entry.sn) ?? ''),
    displayName: String(first(entry.displayName) ?? ''),
    email: String(first(entry.mail) ?? ''),
    department: String(first(entry.department) ?? ''),
    title: String(first(entry.title) ?? ''),
    enabled: (Number(first(entry.userAccountControl)) & 2) === 0
  };
}

// Escapa caracteres reservados de un RDN antes de construir el DN del usuario.
function escapeRdn(value) {
  return value.replace(/([,\\#+<>;"=])/g, '\\$1').replace(/^ | $/g, (space) => `\\${space}`);
}

// Samba AD espera unicodePwd como una cadena entre comillas codificada en UTF-16LE.
function passwordValue(password) {
  return Buffer.from(`"${password}"`, 'utf16le');
}

// Escapa caracteres especiales de RFC 4515 para impedir inyección en filtros LDAP.
function escapeFilterValue(value) {
  return value.replace(/[\0()*\\]/g, (character) => `\\${character.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// Limita la búsqueda a objetos de usuario dentro de la OU configurada.
function userFilter(username) {
  return `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${escapeFilterValue(username)}))`;
}

// Traduce únicamente los campos editables de la API a cambios LDAP.
function toChanges(data) {
  const fields = {
    givenName: 'givenName',
    surname: 'sn',
    displayName: 'displayName',
    email: 'mail',
    department: 'department',
    title: 'title'
  };
  return Object.entries(fields)
    .filter(([key]) => data[key] !== undefined)
    .map(([key, attribute]) => new Change({
      operation: 'replace',
      modification: new Attribute({ type: attribute, values: [data[key]] })
    }));
}

export class UserRepository {
  // Busca una cuenta por nombre y conserva su DN internamente para modificaciones.
  async findByUsername(username) {
    return withLdapClient(async (client) => {
      const { searchEntries } = await client.search(config.LDAP_USERS_OU, {
        scope: 'sub',
        filter: userFilter(username),
        attributes: [...USER_ATTRIBUTES, 'distinguishedName'],
        sizeLimit: 1
      });
      const entry = searchEntries[0];
      return entry ? { ...mapEntry(entry), dn: entry.dn ?? first(entry.distinguishedName) } : null;
    });
  }

  // Recorre páginas LDAP y conserva solo offset + limit + un registro para hasMore.
  async list({ offset, limit }) {
    return withLdapClient(async (client) => {
      const users = [];
      let index = 0;
      let hasMore = false;
      const pages = client.searchPaginated(config.LDAP_USERS_OU, {
        scope: 'sub',
        filter: '(&(objectCategory=person)(objectClass=user))',
        attributes: USER_ATTRIBUTES,
        paged: { pageSize: Math.min(limit + offset + 1, 500) },
        sizeLimit: 0
      });
      for await (const page of pages) {
        for (const entry of page.searchEntries) {
          if (index >= offset && users.length < limit + 1) users.push(mapEntry(entry));
          index += 1;
          if (users.length > limit) {
            hasMore = true;
            break;
          }
        }
        if (hasMore) break;
      }
      return { users: users.slice(0, limit), hasMore };
    });
  }

  // Crea la cuenta y luego establece la contraseña por LDAPS según el requisito de AD.
  async create(data) {
    return withLdapClient(async (client) => {
      if (new URL(config.LDAP_URL).protocol !== 'ldaps:') {
        throw Object.assign(new Error('Crear usuarios con contrasena requiere LDAPS'), { code: 'LDAPS_REQUIRED' });
      }
      const dn = `CN=${escapeRdn(data.username)},${config.LDAP_USERS_OU}`;
      const entry = {
        objectClass: ['top', 'person', 'organizationalPerson', 'user'],
        cn: data.username,
        sAMAccountName: data.username,
        userPrincipalName: data.userPrincipalName,
        givenName: data.givenName,
        sn: data.surname,
        displayName: data.displayName,
        mail: data.email,
        department: data.department,
        title: data.title,
        userAccountControl: data.enabled ? '512' : '514'
      };
      for (const key of Object.keys(entry)) {
        if (entry[key] === undefined || entry[key] === '') delete entry[key];
      }
      await client.add(dn, entry);
      await client.modify(dn, new Change({
        operation: 'replace',
        modification: new Attribute({ type: 'unicodePwd', values: [passwordValue(data.password)] })
      }));
      return this.findByUsername(data.username);
    });
  }

  // Actualiza atributos, contraseña o el bit de cuenta deshabilitada sin alterar otros bits.
  async update(username, data) {
    const user = await this.findByUsername(username);
    if (!user) return null;
    const changes = toChanges(data);
    if (data.enabled !== undefined) {
      const current = await withLdapClient(async (client) => {
        const { searchEntries } = await client.search(user.dn, {
          scope: 'base', filter: '(objectClass=user)', attributes: ['userAccountControl'], sizeLimit: 1
        });
        return Number(first(searchEntries[0]?.userAccountControl) ?? 512);
      });
      const updated = data.enabled ? current & ~2 : current | 2;
      changes.push(new Change({ operation: 'replace', modification: new Attribute({ type: 'userAccountControl', values: [String(updated)] }) }));
    }
    if (data.password) {
      if (new URL(config.LDAP_URL).protocol !== 'ldaps:') {
        throw Object.assign(new Error('Cambiar contrasenas requiere LDAPS'), { code: 'LDAPS_REQUIRED' });
      }
      changes.push(new Change({ operation: 'replace', modification: new Attribute({ type: 'unicodePwd', values: [passwordValue(data.password)] }) }));
    }
    if (changes.length) {
      await withLdapClient((client) => client.modify(user.dn, changes));
    }
    return this.findByUsername(username);
  }

  // Elimina la cuenta encontrada; devuelve false si no existía.
  async remove(username) {
    const user = await this.findByUsername(username);
    if (!user) return false;
    await withLdapClient((client) => client.del(user.dn));
    return true;
  }
}