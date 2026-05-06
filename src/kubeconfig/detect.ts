import type {
  EksContextDetection,
  Kubeconfig,
  KubeconfigCluster,
  KubeconfigExec
} from './types.js';

interface ClusterAndRegion {
  cluster?: string;
  region?: string;
}

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const AWS_ARN_PARTITIONS = new Set(['aws', 'aws-us-gov', 'aws-cn']);
const AWS_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '--ca-bundle',
  '--cli-binary-format',
  '--cli-connect-timeout',
  '--cli-input-json',
  '--cli-read-timeout',
  '--color',
  '--endpoint-url',
  '--output',
  '--profile',
  '--query',
  '--region'
]);

export function findEksContexts(config: Kubeconfig): EksContextDetection[] {
  const clusters = new Map(
    (config.clusters ?? []).map((entry) => [entry.name, entry] as const)
  );
  const users = new Map((config.users ?? []).map((entry) => [entry.name, entry] as const));

  const results: EksContextDetection[] = [];

  for (const contextEntry of config.contexts ?? []) {
    const contextName = contextEntry.name;
    const clusterName = contextEntry.context?.cluster;
    const userName = contextEntry.context?.user;
    const clusterEntry = clusterName === undefined ? undefined : clusters.get(clusterName);
    const userEntry = userName === undefined ? undefined : users.get(userName);

    const awsExec = detectAwsEksGetToken(userEntry?.user?.exec);
    if (awsExec !== undefined) {
      const arn = findArnDetails(userName, contextName, clusterName);
      results.push({
        contextName,
        clusterName,
        userName,
        cluster: awsExec.cluster ?? arn?.cluster,
        region: awsExec.region ?? arn?.region,
        source: 'aws-exec',
        reason: 'user exec command matches aws eks get-token'
      });
      continue;
    }

    const arn = findArnDetails(userName, contextName, clusterName);
    if (arn !== undefined) {
      results.push({
        contextName,
        clusterName,
        userName,
        cluster: arn.cluster,
        region: arn.region,
        source: 'arn',
        reason: 'context, cluster, or user name matches an EKS cluster ARN'
      });
      continue;
    }

    if (isEksServer(clusterEntry?.cluster)) {
      results.push({
        contextName,
        clusterName,
        userName,
        region: extractRegionFromEksServer(clusterEntry?.cluster?.server),
        source: 'server',
        reason: 'cluster server looks like an EKS endpoint'
      });
    }
  }

  return results;
}

function detectAwsEksGetToken(exec: KubeconfigExec | undefined): ClusterAndRegion | undefined {
  if (exec?.command === undefined || !isAwsCommand(exec.command)) {
    return undefined;
  }

  const args = exec.args ?? [];
  if (!hasEksGetTokenCommand(args)) {
    return undefined;
  }

  return extractClusterAndRegionFromArgs(args);
}

function isAwsCommand(command: string): boolean {
  return command === 'aws' || command.endsWith('/aws');
}

function extractClusterAndRegionFromArgs(args: string[]): ClusterAndRegion {
  return {
    cluster: readFlagValue(args, '--cluster-name'),
    region: readFlagValue(args, '--region')
  };
}

function readFlagValue(args: string[], flag: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flag) {
      return readPositionalFlagValue(args[index + 1]);
    }

    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      return readEqualsFlagValue(arg.slice(prefix.length));
    }
  }

  return undefined;
}

function hasEksGetTokenCommand(args: string[]): boolean {
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    if (arg === 'eks') {
      return args[index + 1] === 'get-token';
    }

    if (!arg.startsWith('-')) {
      return false;
    }

    const width = getAwsGlobalOptionWidth(args, index);
    if (width === undefined) {
      return false;
    }

    index += width;
  }

  return false;
}

function getAwsGlobalOptionWidth(args: string[], index: number): number | undefined {
  const arg = args[index];
  const option = arg.split('=', 1)[0];
  if (!AWS_GLOBAL_OPTIONS_WITH_VALUE.has(option)) {
    return 1;
  }

  if (arg.includes('=')) {
    return readEqualsFlagValue(arg.slice(option.length + 1)) === undefined ? undefined : 1;
  }

  return readPositionalFlagValue(args[index + 1]) === undefined ? undefined : 2;
}

function readPositionalFlagValue(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value.startsWith('-')) {
    return undefined;
  }

  return value;
}

function readEqualsFlagValue(value: string): string | undefined {
  return value === '' ? undefined : value;
}

function findArnDetails(...names: Array<string | undefined>): ClusterAndRegion | undefined {
  for (const name of names) {
    if (name === undefined) {
      continue;
    }

    const arn = parseEksClusterArn(name);
    if (arn !== undefined) {
      return arn;
    }
  }

  return undefined;
}

function parseEksClusterArn(name: string): ClusterAndRegion | undefined {
  const parts = name.split(':');
  if (parts.length !== 6) {
    return undefined;
  }

  const [arnPrefix, partition, service, region, accountId, resource] = parts;
  if (
    arnPrefix !== 'arn' ||
    !AWS_ARN_PARTITIONS.has(partition) ||
    service !== 'eks' ||
    !AWS_REGION_PATTERN.test(region) ||
    !isRegionCompatibleWithPartition(partition, region) ||
    !/^\d{12}$/.test(accountId)
  ) {
    return undefined;
  }

  const resourceParts = resource.split('/');
  if (resourceParts.length !== 2 || resourceParts[0] !== 'cluster' || resourceParts[1] === '') {
    return undefined;
  }

  return {
    region,
    cluster: resourceParts[1]
  };
}

function isRegionCompatibleWithPartition(partition: string, region: string): boolean {
  if (partition === 'aws-cn') {
    return region.startsWith('cn-');
  }

  if (partition === 'aws-us-gov') {
    return region.startsWith('us-gov-');
  }

  return !region.startsWith('cn-') && !region.startsWith('us-gov-');
}

function isEksServer(cluster: KubeconfigCluster | undefined): boolean {
  const hostname = getHostname(cluster?.server);
  return (
    hostname !== undefined &&
    (hostname.endsWith('.eks.amazonaws.com') || hostname.endsWith('.eks.amazonaws.com.cn'))
  );
}

function extractRegionFromEksServer(server: string | undefined): string | undefined {
  const hostname = getHostname(server);
  if (hostname === undefined) {
    return undefined;
  }

  const labels = hostname.split('.');
  const eksLabelIndex = labels.indexOf('eks');
  if (eksLabelIndex < 1) {
    return undefined;
  }

  const region = labels[eksLabelIndex - 1];
  return AWS_REGION_PATTERN.test(region) ? region : undefined;
}

function getHostname(server: string | undefined): string | undefined {
  if (server === undefined) {
    return undefined;
  }

  try {
    return new URL(server).hostname;
  } catch {
    return undefined;
  }
}
