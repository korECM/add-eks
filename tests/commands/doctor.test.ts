import { describe, expect, it } from 'vitest';

import {
  formatDoctorHuman,
  runDoctor,
  type DoctorCheckResult,
} from '../../src/commands/doctor.js';

describe('runDoctor', () => {
  it('reports injected setup checks without requiring live credentials', async () => {
    const checks: DoctorCheckResult[] = [
      {
        id: 'aws',
        label: 'AWS CLI',
        status: 'ok',
        message: 'aws-cli/2.15.0',
      },
      {
        id: 'kubectl',
        label: 'kubectl',
        status: 'error',
        message: 'kubectl not found',
      },
      {
        id: 'helper',
        label: 'Token helper',
        status: 'ok',
        message: 'installed',
        path: '/tmp/add-eks-token',
      },
      {
        id: 'cache',
        label: 'Cache directory',
        status: 'warning',
        message: 'missing; will be created on first use',
        path: '/tmp/cache',
      },
      {
        id: 'kubeconfig',
        label: 'Kubeconfig',
        status: 'ok',
        message: 'readable',
        path: '/tmp/config',
      },
    ];

    const result = await runDoctor(
      {
        helperPath: '/tmp/add-eks-token',
        cacheDir: '/tmp/cache',
        kubeconfig: '/tmp/config',
      },
      {
        cliVersion: '9.9.9',
        nodeVersion: 'v20.11.1',
        checks: {
          command: async (command) =>
            checks.find((check) => check.id === command) ?? {
              id: command,
              label: command,
              status: 'error',
              message: 'missing',
            },
          helper: async () => checks[2],
          cacheDir: async () => checks[3],
          kubeconfig: async () => checks[4],
        },
      },
    );

    expect(result).toMatchObject({
      node: { version: 'v20.11.1' },
      cli: { version: '9.9.9' },
      ok: false,
    });
    expect(result.checks.map((check) => check.id)).toEqual([
      'node',
      'cli',
      'aws',
      'kubectl',
      'helper',
      'cache',
      'kubeconfig',
    ]);
    expect(result.checks.find((check) => check.id === 'kubectl')).toMatchObject({
      status: 'error',
      message: 'kubectl not found',
    });
  });

  it('formats human output with status, paths, and versions', async () => {
    const output = formatDoctorHuman({
      ok: true,
      node: { version: 'v20.11.1' },
      cli: { version: '0.1.0' },
      checks: [
        {
          id: 'node',
          label: 'Node.js',
          status: 'ok',
          message: 'v20.11.1',
        },
        {
          id: 'helper',
          label: 'Token helper',
          status: 'ok',
          message: 'executable',
          path: '/tmp/add-eks-token',
        },
      ],
    });

    expect(output).toContain('add-eks doctor');
    expect(output).toContain('OK Node.js: v20.11.1');
    expect(output).toContain('OK Token helper: executable (/tmp/add-eks-token)');
  });
});
