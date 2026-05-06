import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface DiscoverAwsProfilesOptions {
  home?: string;
  configPath?: string;
  credentialsPath?: string;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
}

export async function discoverAwsProfiles(
  options: DiscoverAwsProfilesOptions = {},
): Promise<string[]> {
  const home = options.home ?? os.homedir();
  const configPath = options.configPath ?? path.join(home, '.aws', 'config');
  const credentialsPath = options.credentialsPath ?? path.join(home, '.aws', 'credentials');
  const loadFile = options.readFile ?? readFile;
  const [configSource, credentialsSource] = await Promise.all([
    readOptionalFile(configPath, loadFile),
    readOptionalFile(credentialsPath, loadFile),
  ]);

  return sortProfiles([
    ...parseAwsConfigProfiles(configSource),
    ...parseAwsCredentialsProfiles(credentialsSource),
  ]);
}

export function parseAwsConfigProfiles(source: string): string[] {
  const profiles: string[] = [];

  for (const section of parseIniSections(source)) {
    if (section === 'default') {
      profiles.push('default');
      continue;
    }

    if (section.startsWith('profile ')) {
      const profile = stripOptionalQuotes(section.slice('profile '.length).trim());
      if (profile !== '') {
        profiles.push(profile);
      }
    }
  }

  return profiles;
}

export function parseAwsCredentialsProfiles(source: string): string[] {
  return parseIniSections(source)
    .map(stripOptionalQuotes)
    .filter((profile) => profile !== '');
}

async function readOptionalFile(
  filePath: string,
  loadFile: (filePath: string, encoding: BufferEncoding) => Promise<string>,
): Promise<string> {
  try {
    return await loadFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

function parseIniSections(source: string): string[] {
  const sections: string[] = [];
  const sectionPattern = /^\s*\[([^\]]+)]\s*(?:[#;].*)?$/;

  for (const line of source.split(/\r?\n/)) {
    const match = sectionPattern.exec(line);
    if (match === null) {
      continue;
    }

    const section = match[1]?.trim();
    if (section !== undefined && section !== '') {
      sections.push(section);
    }
  }

  return sections;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function sortProfiles(profiles: string[]): string[] {
  const unique = [...new Set(profiles)];
  return unique.sort((left, right) => {
    if (left === 'default') {
      return -1;
    }

    if (right === 'default') {
      return 1;
    }

    return left.localeCompare(right);
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
