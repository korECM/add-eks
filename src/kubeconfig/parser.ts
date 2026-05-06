import { parse, stringify } from 'yaml';

import type { Kubeconfig } from './types.js';

export function parseKubeconfig(source: string): Kubeconfig {
  return parse(source) as Kubeconfig;
}

// Produces structural YAML output. Callers should create a backup before writing it.
export function stringifyKubeconfig(config: Kubeconfig): string {
  return stringify(config);
}
