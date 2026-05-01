# Inbound Intake

This repository treats GitHub Issues as the canonical intake surface for global-brain work.

## Flow

1. Incoming work is normalized through n8n.
2. A GitHub issue is created before memory or code changes begin.
3. Changes move through a pull request guarded by the PR watcher.
4. Merge remains fail-closed until watcher checks pass.

Tracking issue: `#39`
