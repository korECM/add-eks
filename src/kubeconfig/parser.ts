import { parse, stringify } from 'yaml';

import type { Kubeconfig } from './types.js';

export function parseKubeconfig(source: string): Kubeconfig {
  return parse(source) as Kubeconfig;
}

export function stringifyKubeconfig(config: Kubeconfig): string {
  return stringify(config);
}
