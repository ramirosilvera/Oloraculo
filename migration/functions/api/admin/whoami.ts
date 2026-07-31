// Único endpoint admin que NO exige ya ser admin/aprobado para responder — cualquier usuario
// logueado necesita poder preguntar "¿soy admin? ¿estoy aprobado?" para decidir si ve el nav de
// Admin o la pantalla de "cuenta pendiente" (App.tsx). No filtra nada sensible: dos booleanos. La
// seguridad real está en que cada endpoint mutante/de datos re-verifica por su cuenta (admin vía
// requireAdmin(), portfolios vía la policy portfolios_insert + is_approved() en la DB) — esto es
// puramente para gatear la UI.
import { type Env, json, preflight, guard } from '../_shared';
import { estadoCuenta } from './_guard';

export const onRequestOptions: PagesFunction<Env> = async () => preflight();

export const onRequestGet = guard(async ({ request, env }) => {
  const c = await estadoCuenta(env, request);
  return json({ isAdmin: c?.isAdmin ?? false, isApproved: c?.isApproved ?? false });
});
