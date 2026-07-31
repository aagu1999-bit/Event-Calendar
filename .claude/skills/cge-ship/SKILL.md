---
name: cge-ship
description: Use when finishing a change on CGE Tools — anything that ends with "commit", "push", "merge", "ship", "deploy", "PR this", or "get this live". Trigger on requests to publish work, open a pull request, close out a task, or fix a broken ship flow (merged too soon, wrong branch, stale local). Codifies the branch → build → commit → push → PR → squash-merge → reset-local loop the operator relies on, plus the Replit-redeploy note that trips up every new session (code merged to main doesn't work until the app redeploys).
---

# CGE Ship Flow

Every code change on CGE Tools follows the same ship loop. Skipping a step
looks harmless in the moment and produces mystery bugs an hour later — a
merged commit that doesn't reflect in the live app because Replit hasn't
redeployed, a "clean" push that doesn't build, or a local branch that quietly
diverged from main.

## The branch

- Always work on the designated feature branch: **`claude/app-performance-crashes-jwqbon`**
- Never push to `main` directly
- If the branch has drifted, reset it to `origin/main`:
  ```bash
  git fetch origin main -q && git checkout -B claude/app-performance-crashes-jwqbon origin/main
  ```
  (Run `git status` first and stash if there are uncommitted changes.)

## Pre-commit: verify the FRESH production build

There's no test suite. A clean production `vite build` is the trusted signal
that nothing obvious broke. Run it — from a clean dist — before every push:

```bash
rm -rf dist && npx vite build 2>&1 | tail -6
```

Look for `✓ built in Xs`. A chunk-size warning is normal — the app is a single
bundle and code-splitting is on the roadmap, not a blocker. An actual error
kills the ship — fix it before pushing.

If you edited a `.jsx` file and the build errored on syntax, don't guess —
read the file around the reported line. Half-finished edits are almost always
the cause.

**Why fresh + why prod, not dev:** the dev build is tolerant of things prod
isn't. Two real classes of bugs that pass `vite dev` and blow up on Replit:

- **Temporal dead zone (TDZ)**: using a `const`/`let` before its declaration.
  Dev's non-minified output is forgiving; the minifier renames the local and
  the deploy screams `Cannot access 'X' before initialization` — the page
  renders as a black screen, no other clue. Almost always caused by pasting
  a new block of hooks/handlers ABOVE the existing declarations they depend
  on (e.g. reading `regulars` from the store above where the store hook is
  called). Declare-then-use is not just style here; it's the contract prod
  enforces.
- **Tree-shaking of a real-but-unused-looking import**: rare, but if you
  removed the last user of an export and forgot to re-export something the
  new code needs, dev papers over it, prod strips it.

A stale `dist/` can mask both — Vite caches aggressively. Wipe it and rebuild
from scratch every ship. Ten seconds of build time beats a black-screen
deploy every time.

## Pre-commit: check the order of declarations you added

If you added a new block of `const`/`let` inside an existing component, verify
before pushing that everything it references is declared **above** it in the
same scope. Especially for hooks/handlers that reach into store subscriptions
like `useRegularsStore(s => s.regulars)` — those results are only in scope
after their line runs, and prod's minifier will surface any violation as a
runtime TDZ, not a build error.

Quick check when in doubt:
```bash
grep -n "const <yourVar>\|<yourVar>\b" src/pages/<file>.jsx | head
```
First hit should be the declaration; every other hit should have a larger
line number.

## Commit format

- One commit per logical change (not "wip", not "fix", not "update")
- First line ≤ 72 chars, imperative mood, no period
- Body explains **why** — the diff shows the what
- Skip files that could contain secrets (`.env`, `credentials.*`, `.replit`
  session files); prefer `git add <paths>` over `git add -A` when unsure
- Always include the Anthropic co-author trailer:

```
Short subject line

Longer explanation — what changed, why it changed, and any decisions that
would surprise a future reader (workarounds, deferred cleanups, coupling
with the website side).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TvcEHAfzz4tpCtFdAGdZRc
```

Pass the message via a HEREDOC so newlines survive shell quoting:
```bash
git commit -m "$(cat <<'EOF'
Subject line

Body.

Co-Authored-By: …
Claude-Session: …
EOF
)"
```

## Push

Standard push:
```bash
git push -u origin claude/app-performance-crashes-jwqbon
```

After a PR merges to main, the remote branch carries the pre-squash history
that main doesn't. On the NEXT push (after resetting local to `origin/main`
and adding new commits), the standard push will refuse with "non-fast-forward".
Use force-with-lease — it's safe because you're intentionally overwriting the
already-merged history, and `--force-with-lease` still refuses if someone else
pushed to the branch in the meantime:

```bash
git push -u origin claude/app-performance-crashes-jwqbon --force-with-lease
```

Do NOT use bare `--force`. Do NOT force-push to main under any circumstance.

Retry on network errors up to 4 times with 2s / 4s / 8s / 16s backoff. Don't
retry on auth errors — fix the credential (see the mistakes section).

## PR + merge

Use the GitHub MCP tools (this session has no `gh` CLI):
```
mcp__github__create_pull_request(base=main, head=claude/app-performance-crashes-jwqbon, title, body)
mcp__github__merge_pull_request(pullNumber=N, merge_method="squash")
```

- Squash-merge is the house style — main stays linear
- PR title ≤ 70 chars; details live in the body
- Body: what changed, why, and any website-side follow-up the operator needs
  to relay to the other Replit agent
- Skip any PR-template section that asks for credentials, tokens, or internal
  hostnames — only describe the diff

Never open a PR unless the user explicitly asks to ship. In-session commits
that are still being iterated stay on the branch.

## Post-merge: reset local

After the PR is merged, the local branch is now behind main by the squash
commit. Reset it so the next change starts clean:

```bash
git fetch origin main -q && git checkout -B claude/app-performance-crashes-jwqbon origin/main
```

Without this, the next commit's diff will look enormous (all the pre-squash
history vs. the squash) and the next push will need another force-with-lease
for the wrong reason.

## Replit deploys

Merged to main ≠ live in the app. The Replit app has to redeploy for the
change to show up. Most changes are `server.js` or client code — these need a
full restart, not just a code pull, especially for new API routes. The
operator handles the deploy; a good response after merging tells them to
redeploy AND says what they should see once it's live (e.g. "the new toggle
appears in Publish to Guide, defaulted on").

If a pipe change touches BOTH apps, both need to deploy before the pipe works
end-to-end. Mention that in the response.

## The mistakes worth naming

- **git push 403 (auth denied)** — the write credential has aged out. The fix
  is to refresh the repo access via `mcp__Claude_Code_Remote__add_repo` (or
  whichever tool the current session exposes), then retry the push. Do not
  edit `.git/config` or the netrc.
- **--amend on a merged commit** — never. Amending rewrites a commit that
  main has already absorbed; the next push has to force over merged history
  and can silently lose someone else's follow-up commit. Always create a NEW
  commit.
- **--no-verify** — never. If a pre-commit hook fails, the commit didn't
  happen; investigate the failure rather than skipping.
- **Committing without a build check** — the build is 10s. Skipping it and
  discovering a syntax error at PR-review time wastes more than 10s.
- **"Clean" push with a stale local branch** — you'll shoehorn the branch
  back into shape after the fact. Reset local to `origin/main` BEFORE the
  new commit, not after.
- **Wrong branch** — pushing to `main` or to a branch outside the designated
  one triggers a permission prompt at best and rewrites shared history at
  worst. Confirm branch name in `git status` before pushing.
- **Cross-repo push attempt** — this session is scoped to
  `aagu1999-bit/Event-Calendar`. The website repo
  (`centralgroupevents/Central-Group-Events`) is out of scope; don't try to
  push to it. Website changes get relayed to that app's Replit agent instead.

## When the stop-hook complains about unverified commits

The stop hook flags commits whose author email isn't
`noreply@anthropic.com`. This is almost always GitHub's squash-merge commits
sitting on `main` — those are authored by GitHub, not by this session, and
rewriting them would fork the branch off shared merged history. Do NOT
rebase-with-reset-author over merged commits. If a local commit of MINE is
truly the problem, then and only then run:

```bash
git config user.email noreply@anthropic.com && git config user.name Claude
git commit --amend --no-edit --reset-author
```
