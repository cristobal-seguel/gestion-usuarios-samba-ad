import { Router } from 'express';
import { z } from 'zod';

const usernameSchema = z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/);
const userFields = {
  username: usernameSchema,
  userPrincipalName: z.string().email().max(256),
  password: z.string().min(8).max(128),
  givenName: z.string().min(1).max(64),
  surname: z.string().min(1).max(64),
  displayName: z.string().min(1).max(256),
  email: z.string().email().max(256).optional(),
  department: z.string().max(64).optional(),
  title: z.string().max(64).optional(),
  enabled: z.boolean().default(true)
};
const createSchema = z.object(userFields).strict();
const updateSchema = z.object({
  password: userFields.password.optional(),
  givenName: userFields.givenName.optional(),
  surname: userFields.surname.optional(),
  displayName: userFields.displayName.optional(),
  email: userFields.email,
  department: userFields.department,
  title: userFields.title,
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un campo');
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0)
});

export function createUserRouter(userService) {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = paginationSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Parametros de paginacion invalidos' });
    const result = await userService.list(query.data);
    return res.json({ data: result.users, pagination: { ...query.data, hasMore: result.hasMore } });
  });

  router.post('/', async (req, res) => {
    const body = createSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Datos de usuario invalidos', details: body.error.issues });
    const user = await userService.create(body.data);
    return res.status(201).json({ data: user });
  });

  router.get('/:username', async (req, res) => {
    const username = usernameSchema.safeParse(req.params.username);
    if (!username.success) return res.status(400).json({ error: 'Nombre de usuario invalido' });
    const user = await userService.get(username.data);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ data: user });
  });

  router.patch('/:username', async (req, res) => {
    const username = usernameSchema.safeParse(req.params.username);
    const body = updateSchema.safeParse(req.body);
    if (!username.success) return res.status(400).json({ error: 'Nombre de usuario invalido' });
    if (!body.success) return res.status(400).json({ error: 'Datos de usuario invalidos', details: body.error.issues });
    const user = await userService.update(username.data, body.data);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ data: user });
  });

  router.delete('/:username', async (req, res) => {
    const username = usernameSchema.safeParse(req.params.username);
    if (!username.success) return res.status(400).json({ error: 'Nombre de usuario invalido' });
    const removed = await userService.remove(username.data);
    if (!removed) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.status(204).end();
  });

  return router;
}