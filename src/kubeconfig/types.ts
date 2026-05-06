export interface Kubeconfig {
  apiVersion?: string;
  kind?: string;
  'current-context'?: string;
  clusters?: KubeconfigNamedCluster[];
  contexts?: KubeconfigNamedContext[];
  users?: KubeconfigNamedUser[];
  [key: string]: unknown;
}

export interface KubeconfigNamedCluster {
  name: string;
  cluster?: KubeconfigCluster;
  [key: string]: unknown;
}

export interface KubeconfigCluster {
  server?: string;
  'certificate-authority-data'?: string;
  [key: string]: unknown;
}

export interface KubeconfigNamedContext {
  name: string;
  context?: KubeconfigContext;
  [key: string]: unknown;
}

export interface KubeconfigContext {
  cluster?: string;
  user?: string;
  [key: string]: unknown;
}

export interface KubeconfigNamedUser {
  name: string;
  user?: KubeconfigUser;
  [key: string]: unknown;
}

export interface KubeconfigUser {
  exec?: KubeconfigExec;
  [key: string]: unknown;
}

export interface KubeconfigExec {
  command?: string;
  args?: string[];
  apiVersion?: string;
  interactiveMode?: string;
  [key: string]: unknown;
}

export interface EksContextDetection {
  contextName: string;
  clusterName?: string;
  userName?: string;
  cluster?: string;
  region?: string;
  source: 'aws-exec' | 'arn' | 'server';
  reason?: string;
}
