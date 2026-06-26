# Control Center

Your cockpit for the glm-aio agent system. A single static page — talk to the agent,
dispatch jobs it works off your PC, watch the queue, and see its capabilities.

It's a **direct connection**: the page talks straight to your Cloudflare Worker. It does
**not** touch the autonomous cron — that keeps working the queue on its own.

## Connect (one-time)
Open the page, paste your **Worker URL** (`https://glm-aio.thryx.workers.dev`) and your
**gateway token** (saved at `~/.claude/secrets/finalplan-glm-aio.env`). Both are stored in
*your browser only* (localStorage) — never committed, never sent anywhere but your Worker.

## Deploy on Render (free)
1. Push this repo (private) to GitHub.
2. Render → **New → Static Site** → connect the repo.
3. **Publish directory:** `control-center` · **Build command:** *(leave empty)*.
4. Deploy. (Or use the `render.yaml` Blueprint at the repo root.)

No secrets live on Render — the page asks for your token at runtime. Works equally well on
GitHub Pages (publish the `control-center` folder).

## What each part does
- **Talk to the agent** — chats via `/ask` with persistent memory (it remembers the thread). Toggle *deep thinking* for hard questions.
- **Dispatch a job** — *Run now* works it immediately; *Queue for cron* hands it to the 5-min autonomous loop.
- **Jobs** — live queue + results, auto-refreshing.
- **Capabilities** — pulled live from `/registry`; grows as the system gains tools/automations/apps.
