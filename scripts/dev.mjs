// Runs the API (with auto-reload) and the Vite dashboard together: `npm run dev:all`
import { spawn } from 'node:child_process'

const procs = [
  ['api', 'npx', ['tsx', 'watch', 'server/src/index.ts']],
  ['web', 'npx', ['vite']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' })
  const tag = name === 'api' ? '\x1b[32m[api]\x1b[0m ' : '\x1b[36m[web]\x1b[0m '
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n'))
  p.on('exit', (code) => { console.log(`${tag}exited (${code})`); stop() })
  return p
})
function stop() { for (const p of procs) if (!p.killed) p.kill() ; process.exit() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
