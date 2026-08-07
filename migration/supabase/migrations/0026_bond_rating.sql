-- Calificación crediticia de bonos/ONs (calificadora + nota). Se carga a mano igual que el cupón
-- (ver 0004_bond_coupons.sql): no hay ninguna API configurada en el proyecto que dé rating por bono.
-- Todo nullable: las posiciones que no son bonos, o bonos sin rating cargado, no se afectan.
-- La clasificación en grado de inversión/especulativo/default se calcula en el cliente
-- (engine/rating.ts) a partir de estas dos columnas — no se persiste (es derivada).

alter table posiciones
  add column if not exists calificadora text,   -- 'S&P' | 'Moody''s' | 'Fitch' | 'FIX SCR' | 'Moody''s Local' | 'Otra'
  add column if not exists calificacion text;    -- nota tal cual la da la calificadora (ej. 'BB-', 'Ba3', 'AAA(arg)')

comment on column posiciones.calificadora is 'Calificadora de riesgo (S&P, Moody''s, Fitch = escala global comparable; FIX SCR, Moody''s Local, Otra = escala nacional, no comparable entre países).';
comment on column posiciones.calificacion is 'Nota de calificación tal cual la publica la calificadora (ej. BB-, Ba3, AAA(arg)). Texto libre: la notación varía por calificadora.';
