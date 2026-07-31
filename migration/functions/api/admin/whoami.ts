// Único endpoint admin que NO exige ya ser admin para responder — cualquier usuario logueado
// necesita poder preguntar "¿soy admin?" para decidir si el nav muestra la sección. No filtra nada
// sensible: solo un booleano. La seguridad real está en que cada endpoint mutante re-verifica
// requireAdmin() por su cuenta, así que esto es puramente para gatear la UI.
import { type Env, json, preflight, guard } from '../_shared';
import { requireAdmin } from './_guard';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  const admin = await requireAdmin(env, request);
  return json({ isAdmin: !!admin });
});
