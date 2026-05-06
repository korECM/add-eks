#!/usr/bin/env node
import { Command } from 'commander';

import { name, version } from './index.js';

const program = new Command();

program
  .name(name)
  .description('Friendly EKS kubeconfig setup with cached token support.')
  .version(version)
  .action(() => {
    program.outputHelp();
  });

program.parse(process.argv);
