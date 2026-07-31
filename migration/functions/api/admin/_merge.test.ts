import { describe, it, expect } from 'vitest';
import { armarUsuarios, type GoTrueAdminUser } from './_merge';

const AHORA = '2026-07-31T00:00:00.000Z';

const u = (over: Partial<GoTrueAdminUser> & { id: string; email: string }): GoTrueAdminUser => ({
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('armarUsuarios', () => {
  it('marca admin solo a los que están en admin_users', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'a@x.com' }), u({ id: '2', email: 'b@x.com' })],
      new Set(['2']), new Set(),
      new Map(), new Map(), AHORA,
    );
    expect(out.find(x => x.id === '1')!.isAdmin).toBe(false);
    expect(out.find(x => x.id === '2')!.isAdmin).toBe(true);
  });

  it('isApproved: true si está en usuarios_aprobados', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'a@x.com' }), u({ id: '2', email: 'b@x.com' })],
      new Set(), new Set(['1']),
      new Map(), new Map(), AHORA,
    );
    expect(out.find(x => x.id === '1')!.isApproved).toBe(true);
    expect(out.find(x => x.id === '2')!.isApproved).toBe(false);
  });

  it('isApproved: un admin siempre está aprobado, aunque no esté en usuarios_aprobados', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'a@x.com' })],
      new Set(['1']), new Set(),
      new Map(), new Map(), AHORA,
    );
    expect(out[0].isApproved).toBe(true);
  });

  it('baneado: banned_until en el futuro → banned true', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'a@x.com', banned_until: '2126-01-01T00:00:00.000Z' })],
      new Set(), new Set(), new Map(), new Map(), AHORA,
    );
    expect(out[0].banned).toBe(true);
  });

  it('sin banear: banned_until ausente o en el pasado → banned false', () => {
    const out = armarUsuarios(
      [
        u({ id: '1', email: 'a@x.com' }),
        u({ id: '2', email: 'b@x.com', banned_until: '2020-01-01T00:00:00.000Z' }),
      ],
      new Set(), new Set(), new Map(), new Map(), AHORA,
    );
    expect(out[0].banned).toBe(false);
    expect(out[1].banned).toBe(false); // reactivado (fecha ya pasada)
  });

  it('emailConfirmed: true si hay email_confirmed_at o confirmed_at', () => {
    const out = armarUsuarios(
      [
        u({ id: '1', email: 'a@x.com', email_confirmed_at: '2026-01-01T00:00:00.000Z' }),
        u({ id: '2', email: 'b@x.com' }),
      ],
      new Set(), new Set(), new Map(), new Map(), AHORA,
    );
    expect(out[0].emailConfirmed).toBe(true);
    expect(out[1].emailConfirmed).toBe(false);
  });

  it('displayName y portfolioCount por defecto: null / 0 si no hay entrada', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'a@x.com' })],
      new Set(), new Set(),
      new Map([['1', 'Rami']]),
      new Map(),
      AHORA,
    );
    expect(out[0].displayName).toBe('Rami');
    expect(out[0].portfolioCount).toBe(0);
  });

  it('ordena por email', () => {
    const out = armarUsuarios(
      [u({ id: '1', email: 'zeta@x.com' }), u({ id: '2', email: 'alfa@x.com' })],
      new Set(), new Set(), new Map(), new Map(), AHORA,
    );
    expect(out.map(x => x.email)).toEqual(['alfa@x.com', 'zeta@x.com']);
  });
});
