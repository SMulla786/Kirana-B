import {describe, expect, it} from 'vitest';
import {Prisma} from '@prisma/client';
import {isLooseUnit, resolveFactor, toBaseQuantity} from '../src/utils/units';
import {parseUnit} from '../src/services/kirana/import.service';

const D = (v: string) => new Prisma.Decimal(v);
const factor = (...args: Parameters<typeof resolveFactor>) => {
    const f = resolveFactor(...args);
    if (typeof f === 'string') throw new Error(f);
    return f.toString();
};

describe('unit conversion', () => {
    it('fixes metric factors in both directions and rejects wrong ones', () => {
        expect(factor('GRAM', 'KILOGRAM')).toBe('1000');
        expect(factor('KILOGRAM', 'GRAM')).toBe('0.001');
        expect(factor('MILLILITRE', 'LITRE', D('1000'))).toBe('1000');
        expect(resolveFactor('GRAM', 'KILOGRAM', D('999'))).toMatch(/always 1000/);
        expect(resolveFactor('PIECE', 'KILOGRAM')).toMatch(/cannot be converted/);
        expect(resolveFactor('GRAM', 'LITRE')).toMatch(/cannot be converted/);
    });

    it('needs a whole positive pack size over a count base', () => {
        expect(factor('PIECE', 'CARTON', D('24'))).toBe('24');
        expect(factor('GRAM', 'PACKET', D('500'))).toBe('500'); // a 500 g packet of a loose item
        expect(resolveFactor('PIECE', 'BOX', D('2.5'))).toMatch(/whole number/);
        expect(resolveFactor('PIECE', 'BOX', D('0'))).toMatch(/greater than 0/);
        expect(resolveFactor('PIECE', 'BOX')).toMatch(/Give how many/);
    });

    it('converts fractions exactly and never rounds', () => {
        expect(toBaseQuantity(D('0.5'), D('24'), 'PIECE').toString()).toBe('12');
        expect(toBaseQuantity(D('1.25'), D('1000'), 'GRAM').toString()).toBe('1250');
        expect(toBaseQuantity(D('0.125'), D('1'), 'KILOGRAM').toString()).toBe('0.125');
        // In floats 0.1 * 3 is 0.30000000000000004; Decimal keeps it exact.
        expect(toBaseQuantity(D('0.1'), D('3'), 'KILOGRAM').toString()).toBe('0.3');
        expect(toBaseQuantity(D('250'), D('0.001'), 'KILOGRAM').toString()).toBe('0.25');
    });

    it('rejects results finer than 3 decimals or fractional count units', () => {
        expect(() => toBaseQuantity(D('0.3'), D('5'), 'PIECE')).toThrow(/whole number/);
        expect(() => toBaseQuantity(D('0.0001'), D('1'), 'KILOGRAM')).toThrow(/too precise/);
    });

    it('knows loose units and spreadsheet spellings', () => {
        expect(isLooseUnit('GRAM')).toBe(true);
        expect(isLooseUnit('PACKET')).toBe(false);
        expect(parseUnit('Kg')).toBe('KILOGRAM');
        expect(parseUnit('pcs')).toBe('PIECE');
        expect(parseUnit('litre')).toBe('LITRE');
        expect(parseUnit('CARTON')).toBe('CARTON');
        expect(parseUnit('dozen')).toBeUndefined();
    });
});
