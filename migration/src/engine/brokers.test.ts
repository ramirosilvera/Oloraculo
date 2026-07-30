import { describe, it, expect } from 'vitest';
import { resumenPorBroker, detalleMultiBroker } from './brokers';

const brokers = [{ id: 'iol', nombre: 'IOL' }, { id: 'san', nombre: 'Santander' }];

describe('resumenPorBroker', () => {
  it('sin posiciones → lista vacía', () => {
    expect(resumenPorBroker([], [], brokers)).toEqual([]);
  });

  it('posición entera en un broker → todo el valor a ese broker', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 100, valorUsd: 1000 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 100 }],
      brokers,
    );
    expect(r).toEqual([{ brokerId: 'iol', nombre: 'IOL', valorUsd: 1000, cantidadPosiciones: 1, pct: 1 }]);
  });

  it('posición repartida entre dos brokers → se reparte el valor proporcional a la cantidad', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 100, valorUsd: 1000 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 60 }, { posicionId: 'p1', brokerId: 'san', cantidad: 40 }],
      brokers,
    );
    expect(r.find(x => x.brokerId === 'iol')!.valorUsd).toBe(600);
    expect(r.find(x => x.brokerId === 'san')!.valorUsd).toBe(400);
  });

  it('posición sin ninguna asignación → todo a "Sin asignar"', () => {
    const r = resumenPorBroker([{ id: 'p1', cantidad: 100, valorUsd: 1000 }], [], brokers);
    expect(r).toEqual([{ brokerId: null, nombre: 'Sin asignar', valorUsd: 1000, cantidadPosiciones: 1, pct: 1 }]);
  });

  it('asignación parcial → el resto sin asignar queda como remanente', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 100, valorUsd: 1000 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 30 }],
      brokers,
    );
    expect(r.find(x => x.brokerId === 'iol')!.valorUsd).toBe(300);
    expect(r.find(x => x.brokerId === null)!.valorUsd).toBe(700);
  });

  it('suma varias posiciones en el mismo broker y cuenta cantidadPosiciones', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 100 }, { id: 'p2', cantidad: 5, valorUsd: 50 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 10 }, { posicionId: 'p2', brokerId: 'iol', cantidad: 5 }],
      brokers,
    );
    const iol = r.find(x => x.brokerId === 'iol')!;
    expect(iol.valorUsd).toBe(150);
    expect(iol.cantidadPosiciones).toBe(2);
  });

  it('calcula el % correctamente sobre el total', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 75 }, { id: 'p2', cantidad: 10, valorUsd: 25 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 10 }, { posicionId: 'p2', brokerId: 'san', cantidad: 10 }],
      brokers,
    );
    expect(r.find(x => x.brokerId === 'iol')!.pct).toBeCloseTo(0.75, 9);
    expect(r.find(x => x.brokerId === 'san')!.pct).toBeCloseTo(0.25, 9);
  });

  it('"Sin asignar" siempre queda al final, aunque tenga más valor que los brokers reales', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 1000 }, { id: 'p2', cantidad: 10, valorUsd: 10 }],
      [{ posicionId: 'p2', brokerId: 'iol', cantidad: 10 }],
      brokers,
    );
    expect(r[r.length - 1].brokerId).toBeNull();
  });

  it('ordena de mayor a menor valor (entre brokers reales)', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 10 }, { id: 'p2', cantidad: 10, valorUsd: 90 }],
      [{ posicionId: 'p1', brokerId: 'san', cantidad: 10 }, { posicionId: 'p2', brokerId: 'iol', cantidad: 10 }],
      brokers,
    );
    expect(r[0].brokerId).toBe('iol');
    expect(r[1].brokerId).toBe('san');
  });

  it('un broker_id que ya no existe en la lista de brokers (borrado) no rompe, muestra "Broker eliminado"', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 20 }],
      [{ posicionId: 'p1', brokerId: 'ya-no-existe', cantidad: 10 }],
      brokers,
    );
    expect(r[0].nombre).toBe('Broker eliminado');
  });

  it('total en 0 → pct en 0, no divide por cero', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 0 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 10 }],
      brokers,
    );
    expect(r[0].pct).toBe(0);
  });

  it('asignaciones que suman más que la cantidad real (dato desactualizado) no reparten de más', () => {
    const r = resumenPorBroker(
      [{ id: 'p1', cantidad: 10, valorUsd: 100 }],
      [{ posicionId: 'p1', brokerId: 'iol', cantidad: 8 }, { posicionId: 'p1', brokerId: 'san', cantidad: 8 }],
      brokers,
    );
    const total = r.reduce((s, x) => s + x.valorUsd, 0);
    expect(total).toBe(100);
    expect(r.find(x => x.brokerId === 'san')!.valorUsd).toBe(20); // solo el remanente (10-8)
  });
});

describe('detalleMultiBroker', () => {
  const posiciones = [{ id: 'p1', ticker: 'MELI' }, { id: 'p2', ticker: 'MA' }];

  it('sin asignaciones → lista vacía', () => {
    expect(detalleMultiBroker(posiciones, [], brokers)).toEqual([]);
  });

  it('posición en un solo broker → NO aparece (no aporta info nueva)', () => {
    const r = detalleMultiBroker(posiciones, [{ posicionId: 'p1', brokerId: 'iol', cantidad: 80 }], brokers);
    expect(r).toEqual([]);
  });

  it('posición repartida entre dos brokers → una fila por broker, con ticker/cantidad/broker', () => {
    const r = detalleMultiBroker(posiciones, [
      { posicionId: 'p1', brokerId: 'iol', cantidad: 69 },
      { posicionId: 'p1', brokerId: 'san', cantidad: 11 },
    ], brokers);
    expect(r).toEqual([
      { ticker: 'MELI', cantidad: 69, broker: 'IOL' },
      { ticker: 'MELI', cantidad: 11, broker: 'Santander' },
    ]);
  });

  it('solo incluye las posiciones repartidas, no las de un solo broker', () => {
    const r = detalleMultiBroker(posiciones, [
      { posicionId: 'p1', brokerId: 'iol', cantidad: 69 },
      { posicionId: 'p1', brokerId: 'san', cantidad: 11 },
      { posicionId: 'p2', brokerId: 'iol', cantidad: 106 },
    ], brokers);
    expect(r.every(x => x.ticker === 'MELI')).toBe(true);
    expect(r.length).toBe(2);
  });

  it('ordena por ticker y luego por broker', () => {
    const r = detalleMultiBroker([{ id: 'p1', ticker: 'ZZZ' }, { id: 'p2', ticker: 'AAA' }], [
      { posicionId: 'p1', brokerId: 'san', cantidad: 1 }, { posicionId: 'p1', brokerId: 'iol', cantidad: 2 },
      { posicionId: 'p2', brokerId: 'san', cantidad: 3 }, { posicionId: 'p2', brokerId: 'iol', cantidad: 4 },
    ], brokers);
    expect(r.map(x => x.ticker)).toEqual(['AAA', 'AAA', 'ZZZ', 'ZZZ']);
  });
});
