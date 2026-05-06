import { describe, expect, it } from 'vitest';

import { name } from '../src/index.js';

describe('package smoke test', () => {
  it('exports the CLI package name', () => {
    expect(name).toBe('add-eks');
  });
});
