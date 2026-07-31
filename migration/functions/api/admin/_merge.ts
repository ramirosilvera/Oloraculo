// Combina lo que devuelve la Admin Auth API de GoTrue (auth.users, fuente de la verdad de
// email/estado) con nuestras tablas (admin_users, profiles, portfolios) en una sola fila por
// usuario para la tabla del panel admin. Pura — sin fetch acá — para poder testearla sin mockear
// red, igual que el resto del motor (engine/*).

export interface GoTrueAdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}

export interface AdminUsuario {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  bannedUntil: string | null;
  emailConfirmed: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  displayName: string | null;
  portfolioCount: number;
}

export function armarUsuarios(
  gotrueUsers: GoTrueAdminUser[],
  adminIds: Set<string>,
  approvedIds: Set<string>,
  displayNames: Map<string, string | null>,
  portfolioCounts: Map<string, number>,
  ahoraIso: string,
): AdminUsuario[] {
  return gotrueUsers
    .map(u => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      // banned_until es un timestamp lejano (ej. +100 años) cuando está baneado, o ausente/pasado
      // si no. Comparación de strings ISO-8601: funciona porque son todos UTC con el mismo formato
      // (misma cantidad de dígitos), sin necesidad de parsear a Date.
      banned: !!u.banned_until && u.banned_until > ahoraIso,
      bannedUntil: u.banned_until ?? null,
      emailConfirmed: !!(u.email_confirmed_at || u.confirmed_at),
      isAdmin: adminIds.has(u.id),
      // Admin ⇒ aprobado siempre, igual que is_approved() en la DB (0021_aprobacion_cuentas.sql).
      isApproved: adminIds.has(u.id) || approvedIds.has(u.id),
      displayName: displayNames.get(u.id) ?? null,
      portfolioCount: portfolioCounts.get(u.id) ?? 0,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
