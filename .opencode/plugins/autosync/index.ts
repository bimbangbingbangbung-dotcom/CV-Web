import { Plugin } from "@opencode/plugin"

/**
 * autosync - automatically commits and pushes changes to GitHub.
 *
 * After every tool execution (file writes, edits, shell commands, subagents)
 * it waits a few seconds for changes to settle, then runs:
 *
 *   git add -A -> git commit -> git push
 *
 * If the working tree is clean it does nothing, so read-only actions never
 * create empty commits.
 */

const SETTLE_MS = 3000

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let queued = false
let target: string | undefined

async function git(dir: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args[0]} exited ${code}: ${err.trim() || out.trim()}`)
  return out
}

async function sync(dir: string): Promise<void> {
  try {
    await git(dir, ["add", "-A"])
    const status = await git(dir, ["status", "--porcelain"])
    if (!status.trim()) return

    const count = status.trim().split(/\r?\n/).length
    await git(dir, ["commit", "-m", `Auto-save: ${count} file(s) updated`])

    try {
      await git(dir, ["push"])
    } catch (pushErr) {
      // Commit succeeded locally; retry push on the next sync cycle.
      console.error("[autosync] push failed (will retry later):", pushErr)
      throw pushErr
    }
    console.log(`[autosync] pushed ${count} changed file(s) to GitHub`)
  } catch (err) {
    console.error("[autosync]", err)
  }
}

async function flush(): Promise<void> {
  timer = undefined
  if (running) {
    queued = true
    return
  }
  const dir = target
  if (!dir) return

  running = true
  await sync(dir)
  running = false

  if (queued) {
    queued = false
    schedule(dir)
  }
}

function schedule(dir: string): void {
  target = dir
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), SETTLE_MS)
}

export default Plugin.define({
  id: "autosync",
  async setup(ctx) {
    const registration = await ctx.tool.hook("execute.after", () => {
      const dir = ctx.location.project?.canonical ?? ctx.location.directory
      if (dir) schedule(dir)
    })

    return () => {
      registration.dispose()
      if (timer) clearTimeout(timer)
    }
  },
})
