#!/usr/bin/env node
import { Command } from 'commander';

import { name } from './index.js';

const program = new Command();

program
  .name(name)
  .description('Friendly EKS kubeconfig setup with cached token support.')
  .version('0.1.0')
  .action(() => {
    program.outputHelp();
  });

program.parse(process.argv);
