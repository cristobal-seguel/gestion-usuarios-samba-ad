import { UserRepository } from '../ldap/userRepository.js';

export class UserService {
  constructor(repository = new UserRepository()) {
    this.repository = repository;
  }

  async list(options) {
    return this.repository.list(options);
  }

  async get(username) {
    return this.repository.findByUsername(username);
  }

  async create(data) {
    if (await this.repository.findByUsername(data.username)) {
      throw Object.assign(new Error('El usuario ya existe'), { status: 409, code: 'USER_EXISTS' });
    }
    return this.repository.create(data);
  }

  async update(username, data) {
    return this.repository.update(username, data);
  }

  async remove(username) {
    return this.repository.remove(username);
  }
}