#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [,, command, ...args] = process.argv;

const commands = {
  dev: {
    desc: 'Start local development servers (Frontend & API)',
    run: () => {
      console.log('🚀 Starting LeTsMeet development environment...');
      spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });
      spawn('npm', ['run', 'server:livekit-token'], { stdio: 'inherit', shell: true });
    }
  },
  'dev:staging': {
    desc: 'Start development servers connected to Staging Environment',
    run: () => {
      console.log('🚀 Starting LeTsMeet (Staging Environment)...');
      spawn('npm', ['run', 'dev:staging'], { stdio: 'inherit', shell: true });
      spawn('npm', ['run', 'server:staging'], { stdio: 'inherit', shell: true });
    }
  },
  verify: {
    desc: 'Run all staging security and integration harnesses',
    run: () => {
      console.log('🔍 Running staging verification harness...');
      spawn('node', ['scripts/verify-all-sprint-objectives.mjs'], { stdio: 'inherit', shell: true });
    }
  },
  test: {
    desc: 'Run unit tests (Vitest)',
    run: () => {
      spawn('npm', ['run', 'test'], { stdio: 'inherit', shell: true });
    }
  },
  lint: {
    desc: 'Run ESLint across the project',
    run: () => {
      spawn('npm', ['run', 'lint'], { stdio: 'inherit', shell: true });
    }
  },
  build: {
    desc: 'Build project for production',
    run: () => {
      spawn('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
    }
  }
};

if (!command || command === 'help') {
  console.log('\n🚀 LeTsMeet CLI Tool');
  console.log('Usage: letsmeet <command>\n');
  console.log('Commands:');
  for (const [cmd, { desc }] of Object.entries(commands)) {
    console.log(`  ${cmd.padEnd(15)} ${desc}`);
  }
  console.log('');
  process.exit(0);
}

if (commands[command]) {
  commands[command].run();
} else {
  console.error(`❌ Unknown command: ${command}`);
  console.log(`Run 'letsmeet help' for available commands.`);
  process.exit(1);
}
