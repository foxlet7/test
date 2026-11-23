# find-skills (Claude Code plugin)

Adds a `find-skills` skill that helps Claude search the open skills ecosystem ([skills.sh](https://skills.sh)), vet candidates (install counts, publisher, contents) and install the chosen one with `npx skills add`.

Inspired by the `find-skills` skill in [vercel-labs/skills](https://github.com/vercel-labs/skills); this is an independent write-up.

## Install

```
/plugin marketplace add foxlet7/test
/plugin install find-skills@foxlet7-plugins
```

Then ask things like "is there a skill for writing Playwright tests?" or run `/find-skills`.

License: MIT.

Requires Node.js (`npx`) and network access to npm and GitHub.
