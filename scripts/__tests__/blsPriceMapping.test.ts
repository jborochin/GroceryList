import {
  mapBlsSeriesToPrice,
  BlsSeriesResponse,
  BlsMappingEntry,
} from '../lib/blsPriceMapping';

function seriesWith(...points: Array<{ period: string; value: string }>): BlsSeriesResponse {
  return {
    seriesID: 'TEST0000000000',
    data: points.map((p) => ({
      year: '2026',
      period: p.period,
      periodName: 'Test',
      value: p.value,
    })),
  };
}

describe('mapBlsSeriesToPrice', () => {
  it('applies a factor of 1 for a direct unit match (lb -> lb)', () => {
    const series = seriesWith({ period: 'M06', value: '5.878' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    const result = mapBlsSeriesToPrice(series, mapping);
    expect(result?.price).toBe(5.88);
    expect(result?.year).toBe('2026');
    expect(result?.periodName).toBe('Test');
  });

  it('applies a fractional factor for a unit conversion (dozen -> each)', () => {
    const series = seriesWith({ period: 'M06', value: '3.60' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000708111', blsUnit: 'dozen', factor: 1 / 12 };
    expect(mapBlsSeriesToPrice(series, mapping)?.price).toBe(0.3);
  });

  it('picks the data point with the greatest (year, period) rather than the first monthly point in array order', () => {
    const series = seriesWith({ period: 'M05', value: '5.60' }, { period: 'M06', value: '5.70' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    const result = mapBlsSeriesToPrice(series, mapping);
    expect(result?.price).toBe(5.7);
  });

  it('skips a non-monthly period (M13 annual average) and uses the newest monthly point', () => {
    const series = seriesWith({ period: 'M13', value: '5.50' }, { period: 'M05', value: '5.60' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    const result = mapBlsSeriesToPrice(series, mapping);
    expect(result?.price).toBe(5.6);
    expect(result?.year).toBe('2026');
    expect(result?.periodName).toBe('Test');
  });

  it('returns null for an empty data array', () => {
    const series: BlsSeriesResponse = { seriesID: 'APU0000703112', data: [] };
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBeNull();
  });

  it('returns null when no data point has a parseable numeric value', () => {
    const series = seriesWith({ period: 'M06', value: '-' });
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(series, mapping)).toBeNull();
  });

  it('returns null for a null or undefined series', () => {
    const mapping: BlsMappingEntry = { seriesId: 'APU0000703112', blsUnit: 'lb', factor: 1 };
    expect(mapBlsSeriesToPrice(null, mapping)).toBeNull();
    expect(mapBlsSeriesToPrice(undefined, mapping)).toBeNull();
  });
});
