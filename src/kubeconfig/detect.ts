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

const EKS_ARN_PATTERN = /^arn:aws(?:-[a-z]+)?:eks:([^:]+):\d{12}:cluster\/(.+)$/;
const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;

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
  if (args[0] !== 'eks' || args[1] !== 'get-token') {
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
      return args[index + 1];
    }

    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }

  return undefined;
}

function findArnDetails(...names: Array<string | undefined>): ClusterAndRegion | undefined {
  for (const name of names) {
    if (name === undefined) {
      continue;
    }

    const match = EKS_ARN_PATTERN.exec(name);
    if (match !== null) {
      return {
        region: match[1],
        cluster: match[2]
      };
    }
  }

  return undefined;
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
