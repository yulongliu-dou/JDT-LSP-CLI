import { buildAdoptiumUrl } from '../../../../src/jdt/embedded/jreManager';

describe('buildAdoptiumUrl', () => {
  it('builds correct URL for Windows x64', () => {
    const url = buildAdoptiumUrl('windows', 'x64');
    expect(url).toContain('/v3/assets/latest/21/hotspot');
    expect(url).toContain('image_type=jre');
    expect(url).toContain('os=windows');
    expect(url).toContain('arch=x64');
    expect(url).toContain('vendor=eclipse');
  });

  it('builds correct URL for macOS arm64', () => {
    const url = buildAdoptiumUrl('mac', 'aarch64');
    expect(url).toContain('os=mac');
    expect(url).toContain('arch=aarch64');
  });

  it('builds correct URL for Linux x64', () => {
    const url = buildAdoptiumUrl('linux', 'x64');
    expect(url).toContain('os=linux');
    expect(url).toContain('arch=x64');
  });
});
