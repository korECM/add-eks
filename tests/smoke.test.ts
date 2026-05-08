import { describe, expect, it } from 'vitest';

import { name, version } from '../src/index.js';

describe('package smoke test', () => {
  it('exports the CLI package name', () => {
    expect(name).toBe('add-eks');
  });

  it('exports the CLI package version', () => {
    expect(version).toBe('0.1.0');
  });
});
