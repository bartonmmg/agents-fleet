#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).catch((err) => {
  console.error(`✖ ${err.message}`);
  if (process.env.FLEET_DEBUG) console.error(err.stack);
  process.exit(1);
});
