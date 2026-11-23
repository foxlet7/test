---
name: find-skills
description: Find and install agent skills from the open skills ecosystem. Use when the user asks "is there a skill for X", "find a skill that does X", "how do I do X" for a specialized task a packaged skill may already cover, or wants to extend Claude with new tools, templates or workflows.
---

# Find Skills

Help the user find an existing, trustworthy skill for their task and install it, instead of re-inventing it.

The ecosystem is browsable at https://skills.sh and managed with the `skills` CLI (run through `npx`, no install needed).

## Workflow

1. **Pin down the need.** Restate in one line: the domain (e.g. React, PDFs, testing), the concrete task, and 2–4 search keywords including synonyms.

2. **Search.**
   ```bash
   npx skills find <keywords>
   ```
   Narrow to a publisher with `--owner <github-owner>`. If nothing fits, retry with broader or alternative terms before giving up. Well-known collections worth checking: `vercel-labs/agent-skills`, `anthropics/skills`.

3. **Vet before recommending.** Never recommend on a search hit alone. For each candidate check:
   - Install count on skills.sh: favour well-used skills; flag anything with very few installs.
   - Publisher: official orgs (e.g. `anthropics`, `vercel-labs`, `microsoft`) are a strong signal; for others, look at the repo's stars and recent activity.
   - Contents: read the skill's `SKILL.md` and any bundled scripts. Flag skills that run network calls, shell commands or ask for credentials beyond what the task needs.

4. **Present 1–3 options**, best first, each with: name, what it does, source repo, install count, a skills.sh link, and the exact install command. Say which one you recommend and why.

5. **Install only after the user picks one.**
   ```bash
   npx skills add <owner/repo@skill>        # project scope
   npx skills add <owner/repo@skill> -g     # global (all projects)
   ```
   Add `-y` to skip the CLI's confirmation only when the user has already approved. Afterwards, tell the user the skill is available (a new session may be needed for it to load).

## When nothing fits

Say so plainly, offer to do the task directly, and, if it is a recurring need, offer to scaffold a new skill:
```bash
npx skills init <skill-name>
```

## Other commands

- `npx skills update` — update installed skills.
