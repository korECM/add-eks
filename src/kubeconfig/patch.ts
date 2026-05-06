import type { CacheKeyStrategy } from '../core/options.js';
import { findEksContexts } from './detect.js';
import type { EksContextDetection, Kubeconfig, KubeconfigExec } from './types.js';

const DEFAULT_EXEC_API_VERSION = 'client.authentication.k8s.io/v1beta1';

export interface PlanPatchInput {
  config: Kubeconfig;
  contexts: string[];
  helperPath: string;
  cacheDir: string;
  safetyMargin: number;
  cacheKey: CacheKeyStrategy;
  profile?: string;
}

export interface PlanPatchResult {
  config: Kubeconfig;
  changedContexts: string[];
}

export function planPatch(input: PlanPatchInput): PlanPatchResult {
  const selectedContextNames = [...new Set(input.contexts)];
  const originalContexts = new Map(
    (input.config.contexts ?? []).map((entry) => [entry.name, entry] as const)
  );
  const userReferenceCounts = countUserReferences(input.config);
  const usedUserNames = collectReservedUserNames(input.config);
  const detections = new Map(
    findEksContexts(input.config).map((detection) => [detection.contextName, detection] as const)
  );

  const patchPlans = selectedContextNames.map((contextName) => {
    if (!originalContexts.has(contextName)) {
      throw new Error(`Selected context '${contextName}' does not exist`);
    }

    const detection = detections.get(contextName);
    if (!hasClusterAndRegion(detection)) {
      throw new Error(
        `Selected context '${contextName}' is not a detectable EKS context with cluster and region`
      );
    }

    const originalUserName = originalContexts.get(contextName)?.context?.user;
    if (originalUserName === undefined) {
      throw new Error(`Selected context '${contextName}' does not specify a user to patch`);
    }
    const userIsShared = (userReferenceCounts.get(originalUserName) ?? 0) > 1;

    return {
      contextName,
      originalUserName,
      targetUserName: userIsShared
        ? reservePatchedUserName(usedUserNames, originalUserName, contextName)
        : originalUserName,
      cloneUser: userIsShared,
      cluster: detection.cluster,
      region: detection.region
    };
  });

  const config = structuredClone(input.config);
  const contexts = new Map((config.contexts ?? []).map((entry) => [entry.name, entry] as const));
  const users = new Map((config.users ?? []).map((entry) => [entry.name, entry] as const));
  const changedContexts: string[] = [];

  for (const plan of patchPlans) {
    const userEntry = users.get(plan.originalUserName);
    if (userEntry === undefined) {
      throw new Error(
        `Selected context '${plan.contextName}' references missing user '${plan.originalUserName}'`
      );
    }

    const existingUser = userEntry.user ?? {};
    const existingExec = existingUser.exec;
    const patchedUser = {
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

    if (plan.cloneUser) {
      const contextEntry = contexts.get(plan.contextName);
      if (contextEntry?.context === undefined) {
        throw new Error(`Selected context '${plan.contextName}' does not specify patchable details`);
      }

      contextEntry.context.user = plan.targetUserName;
      const clonedUserEntry = {
        ...userEntry,
        name: plan.targetUserName,
        user: patchedUser
      };
      config.users = [...(config.users ?? []), clonedUserEntry];
      users.set(plan.targetUserName, clonedUserEntry);
    } else {
      userEntry.user = patchedUser;
    }

    changedContexts.push(plan.contextName);
  }

  return { config, changedContexts };
}

function countUserReferences(config: Kubeconfig): Map<string, number> {
  const counts = new Map<string, number>();

  for (const contextEntry of config.contexts ?? []) {
    const userName = contextEntry.context?.user;
    if (userName !== undefined) {
      counts.set(userName, (counts.get(userName) ?? 0) + 1);
    }
  }

  return counts;
}

function collectReservedUserNames(config: Kubeconfig): Set<string> {
  const userNames = new Set((config.users ?? []).map((entry) => entry.name));

  for (const contextEntry of config.contexts ?? []) {
    const userName = contextEntry.context?.user;
    if (userName !== undefined) {
      userNames.add(userName);
    }
  }

  return userNames;
}

function reservePatchedUserName(
  usedUserNames: Set<string>,
  originalUserName: string,
  contextName: string
): string {
  const baseName = `${originalUserName}:add-eks:${contextName}`;
  let candidate = baseName;
  let suffix = 2;

  while (usedUserNames.has(candidate)) {
    candidate = `${baseName}:${suffix}`;
    suffix += 1;
  }

  usedUserNames.add(candidate);
  return candidate;
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
  cacheKey: CacheKeyStrategy;
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
  cacheKey: CacheKeyStrategy;
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
