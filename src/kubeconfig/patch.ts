import { findEksContexts } from './detect.js';
import type { EksContextDetection, Kubeconfig, KubeconfigExec } from './types.js';

const DEFAULT_EXEC_API_VERSION = 'client.authentication.k8s.io/v1beta1';

export interface PlanPatchInput {
  config: Kubeconfig;
  contexts: string[];
  helperPath: string;
  cacheDir: string;
  safetyMargin: number;
  cacheKey: string;
  profile?: string;
}

export interface PlanPatchResult {
  config: Kubeconfig;
  changedContexts: string[];
}

export function planPatch(input: PlanPatchInput): PlanPatchResult {
  const originalContexts = new Map(
    (input.config.contexts ?? []).map((entry) => [entry.name, entry] as const)
  );
  const detections = new Map(
    findEksContexts(input.config).map((detection) => [detection.contextName, detection] as const)
  );

  const patchPlans = input.contexts.map((contextName) => {
    if (!originalContexts.has(contextName)) {
      throw new Error(`Selected context '${contextName}' does not exist`);
    }

    const detection = detections.get(contextName);
    if (!hasClusterAndRegion(detection)) {
      throw new Error(
        `Selected context '${contextName}' is not a detectable EKS context with cluster and region`
      );
    }

    const userName = originalContexts.get(contextName)?.context?.user;
    if (userName === undefined) {
      throw new Error(`Selected context '${contextName}' does not specify a user to patch`);
    }

    return {
      contextName,
      userName,
      cluster: detection.cluster,
      region: detection.region
    };
  });

  const config = structuredClone(input.config);
  const users = new Map((config.users ?? []).map((entry) => [entry.name, entry] as const));
  const changedContexts: string[] = [];

  for (const plan of patchPlans) {
    const userEntry = users.get(plan.userName);
    if (userEntry === undefined) {
      throw new Error(
        `Selected context '${plan.contextName}' references missing user '${plan.userName}'`
      );
    }

    const existingUser = userEntry.user ?? {};
    const existingExec = existingUser.exec;

    userEntry.user = {
      ...existingUser,
      exec: buildExec({
        existingExec,
        helperPath: input.helperPath,
        cluster: plan.cluster,
        region: plan.region,
        cacheDir: input.cacheDir,
        safetyMargin: input.safetyMargin,
        cacheKey: input.cacheKey,
        profile: input.profile
      })
    };
    changedContexts.push(plan.contextName);
  }

  return { config, changedContexts };
}

function hasClusterAndRegion(
  detection: EksContextDetection | undefined
): detection is EksContextDetection & { cluster: string; region: string } {
  return detection?.cluster !== undefined && detection.region !== undefined;
}

function buildExec(input: {
  existingExec: KubeconfigExec | undefined;
  helperPath: string;
  cluster: string;
  region: string;
  cacheDir: string;
  safetyMargin: number;
  cacheKey: string;
  profile?: string;
}): KubeconfigExec {
  return {
    ...input.existingExec,
    apiVersion: input.existingExec?.apiVersion ?? DEFAULT_EXEC_API_VERSION,
    command: input.helperPath,
    args: buildArgs(input),
    interactiveMode: 'Never'
  };
}

function buildArgs(input: {
  cluster: string;
  region: string;
  cacheDir: string;
  safetyMargin: number;
  cacheKey: string;
  profile?: string;
}): string[] {
  const args = [
    '--cluster',
    input.cluster,
    '--region',
    input.region,
    '--cache-dir',
    input.cacheDir,
    '--safety-margin',
    String(input.safetyMargin),
    '--cache-key',
    input.cacheKey
  ];

  if (input.profile !== undefined) {
    args.push('--profile', input.profile);
  }

  return args;
}
