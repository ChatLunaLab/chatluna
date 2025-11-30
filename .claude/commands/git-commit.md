---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: Create a git commit
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes, create a single git commit. Use the Angular commit message format：

<type>(<scope>): <subject>
<BLANK LINE>
<body>
<BLANK LINE>
<footer>

The header is mandatory and the scope of the header is optional.

Your must add the scope of the change you are making. By default, the scope is the name of the subfolder you changed. e.g. docs, build, core, etc.
