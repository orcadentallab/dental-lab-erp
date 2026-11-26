import { describe, expect, it } from 'vitest';
import { normalizeDoctorName, isArabicDoctorName, inferDoctorCodeRegion } from '../../src/lib/doctorIdentity';

describe('approved doctor identity rules', () => {
    it.each(['دكتور أحمد علي', 'د. أحمد علي', 'د.أحمد علي', 'الدكتورة أحمد علي', 'دكتور د. أحمد علي'])('removes leading title: %s', name => {
        expect(normalizeDoctorName(name)).toBe('أحمد علي');
    });
    it('normalizes spacing and vocalization without removing parts of the name', () => {
        expect(normalizeDoctorName('  أَحمد   علي  ')).toBe('أحمد علي');
        expect(normalizeDoctorName('محمد دكتور علي')).toBe('محمد دكتور علي');
    });
    it.each(['أحمد', 'Ahmed Ali', 'أحمد Ali', 'أحمد 123', 'د.'])('rejects non-Arabic or single-part name: %s', name => {
        expect(isArabicDoctorName(name)).toBe(false);
    });
    it.each([['1062', 'cairo'], ['2031', 'east_cairo'], ['3001', 'west_giza'], ['5001', 'damietta'], ['6001', 'other'], ['1062-001', 'cairo']])('recognizes region of %s', (code, region) => {
        expect(inferDoctorCodeRegion(code)).toBe(region);
    });
    it('does not assign a region to reserved or unknown code formats', () => {
        expect(inferDoctorCodeRegion('4001')).toBeUndefined();
        expect(inferDoctorCodeRegion('DOC-10000')).toBeUndefined();
    });
});
