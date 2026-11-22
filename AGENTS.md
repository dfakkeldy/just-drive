# AGENTS.md

Rules for coding agents that read `AGENTS.md` (Codex, Antigravity and
others). Claude Code reads [CLAUDE.md](CLAUDE.md). The rules are the same.

## Read CLAUDE.md first

All the repository rules are in CLAUDE.md. Read it in full before you work.
This file only adds the rules for agents that work on a task for another
agent.

@[CLAUDE.md](CLAUDE.md)

## Rules for delegated work

- Open every PR as a draft (`gh pr create --draft`). A ready PR with a
  `Reviewed-by:` line can be merged by the PR steward before its gates pass.
- Have your own fixes reviewed by another agent before a PR lands. This
  also applies to fixes you make after a review. A review of your own work
  by you does not count. Name the reviewer in the `Reviewed-by:` line.
- Land a PR only with `python3 ~/.claude/guardrails/land_pr.py`. Run it
  again after each push. Do not use GitHub auto-merge, `--admin` or a
  force-push to a shared branch.
- Do not open `reference/`, dash-cam footage, private photos or private
  notes under `data/work/`, unless your task says to. Never commit,
  upload or post them.
- Do not publish the site or deploy. Install land data only when your
  task gives the steps for it.
- Ask questions in the tracking issue your task names, not in the PR.
- Give times in Halifax time (`America/Halifax`).
