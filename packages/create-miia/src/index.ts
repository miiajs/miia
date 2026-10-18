#!/usr/bin/env node
import { run } from '@miiajs/cli'

const argv = process.argv.slice(2)
// citty answers --version only when it is the sole argument; `new --version` would not
await run(argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v') ? argv : ['new', ...argv])
