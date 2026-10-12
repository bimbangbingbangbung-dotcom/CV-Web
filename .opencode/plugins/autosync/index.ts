import { Plugin } from "@opencode/plugin"

/**
 * autosync - automatically commits and pushes changes to GitHub.
 *
 * After tool executions that may change files (write, edit, shell, ...) it
 * waits a few seconds for changes to settle, then runs:
 *
 *   git add -A -> git commit -> git push
 *
 * If the working tree is clean it does nothing, so read-only actions never
 * create empty commits.
 *
 * Supports both OpenCode V2 (Plugin.define + setup) and V1 (server() hooks)
 * from one entrypoint.
 */

import { appendFileSync } from "node:fs"

const SETTLE_MS = 3000

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let queued = false
let target: string | undefined

/** Append a diagnostic line to .opencode/autosync.log so behavior is observable. */
function debug(dir: string | undefined, msg: string): void {
  try {
    if (!dir) return
    appendFileSync(`${dir}/.opencode/autosync.log`, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // never let logging break the sync
  }
}

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
    if (!status.trim()) {
      debug(dir, "sync: nothing to commit")
      return
    }

    const count = status.trim().split(/\r?\n/).length
    await git(dir, ["commit", "-m", `Auto-save: ${count} file(s) updated`])

    try {
      await git(dir, ["push"])
    } catch (pushErr) {
      // Commit succeeded locally; retry push on the next sync cycle.
      debug(dir, `sync: push FAILED (will retry): ${pushErr instanceof Error ? pushErr.message : pushErr}`)
      throw pushErr
    }
    debug(dir, `sync: pushed ${count} changed file(s)`)
    console.log(`[autosync] pushed ${count} changed file(s) to GitHub`)
  } catch (err) {
    debug(dir, `sync: ERROR ${err instanceof Error ? err.message : String(err)}`)
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

  debug(dir, "flush: start")
  running = true
  await sync(dir)
  running = false

  if (queued) {
    queued = false
    schedule(dir)
  }
}

function schedule(dir: string): void {
  if (!dir) return
  debug(dir, "change detected -> scheduling sync")
  target = dir
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flush(), SETTLE_MS)
}

export default {
  // ---- OpenCode V2 -------------------------------------------------------
  ...Plugin.define({
    id: "autosync",
    async setup(ctx) {
      const dir = ctx.location.project?.canonical ?? ctx.location.directory
      debug(dir, "V2 setup: registered execute.after hook")
      const registration = await ctx.tool.hook("execute.after", () => schedule(dir))

      return () => {
        void registration.dispose()
        if (timer) clearTimeout(timer)
      }
    },
  }),

  // ---- OpenCode V1 (legacy CLI) ------------------------------------------
  async server(ctx?: { directory?: string; worktree?: string }) {
    const dir = ctx?.worktree ?? ctx?.directory ?? process.cwd()
    debug(dir, "V1 server(): registered hooks")
    return {
      "tool.execute.after": async () => schedule(dir),
      event: async ({ event }: { event?: { type?: string } }) => {
        if (event?.type === "session.idle") schedule(dir)
      },
    }
  },
}
