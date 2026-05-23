import { parseJavaVersion, detectJavaVersion } from '../../../../src/jdt/embedded/jreManager';

describe('parseJavaVersion', () => {
  it('extracts major version from openjdk output', () => {
    expect(parseJavaVersion('openjdk version "21.0.5" 2024-10-15')).toBe(21);
  });

  it('extracts major version from Oracle Java output', () => {
    expect(parseJavaVersion('java version "21.0.1" 2023-10-17 LTS')).toBe(21);
  });

  it('returns null for unparseable output', () => {
    expect(parseJavaVersion('not a java version string')).toBeNull();
  });

  it('extracts version 17', () => {
    expect(parseJavaVersion('openjdk version "17.0.9" 2023-10-17')).toBe(17);
  });

  it('extracts version from single-digit major', () => {
    expect(parseJavaVersion('openjdk version "1.8.0_392"')).toBe(8);
  });
});
