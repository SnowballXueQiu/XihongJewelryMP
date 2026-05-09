import { execSync } from 'node:child_process'

const ports = [8000, 3001]

for (const port of ports) {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (!output) continue
    const pids = [...new Set(output.split(/\s+/).filter(Boolean))]
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM')
        console.log(`freed port ${port} from pid ${pid}`)
      } catch {
        // Process may already be gone.
      }
    }
  } catch {
    // lsof exits non-zero when no process is listening on the port.
  }
}
