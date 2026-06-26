# Automation Roadmap — Honest Edition (2026-06-26)

> Produced by a 51-agent portfolio scan (hub + Desktop + Archive), adversarially vetted.
> 38 assets seen → 12 promising → 35 flows proposed → 20 survived, 15 killed.

## 1. TLDR

**No flow here has a validated revenue mechanic. Say it plainly: THRYX is wound down, $0 lifetime across 21 deploys, ~$3.28 dust.** Every "revenue" survivor is really a $0 falsification probe or a gated harvester that will almost certainly find ~$0. So build the one thing that delivers real value *today*: the **MyWallets Treasury Watchdog** — a read-only CF Workers cron over your OWN wallets (balance/approval/drain alerts). Its mechanic (on-chain reads + diff + alert) is validated and works right now, it *saves* money instead of chasing dead revenue, and it's the foundation piece that proves out every read/alert pattern the other flows need. In parallel, run the **AuditSuites101 20-line falsifier** — it's the only cheap shot at a *new* mechanic (can free GLM rediscover paid-grade audit bugs?), $0 to answer.

## 2. Build next (ranked)

**1. MyWallets — Treasury Watchdog** *(VALIDATED mechanic; build now)*
- **Agent:** every ~30 min, reads all 7 wallets via ThryxBaseRPC + Multicall3 + a getLogs Approval/Transfer pass, diffs vs prior R2/KV snapshot, alerts on ETH drop, gas-floor breach, ANY new approval, or NEVER_TOUCH-token inflow.
- **Value:** catches the exact failure modes that have already cost real ETH (forgotten approvals, silent drains) *before* loss. Defensive infra for his own treasury.
- **Honesty:** mechanic is real and works today — reads are deterministic. It's defensive infra, not revenue.

**2. AuditSuites101 — GLM-recall falsifier** *(NEEDS 20-line test; only real shot at NEW revenue)*
- **Agent:** feed 10 already-closed Code4rena/Sherlock scopes to glm-4.5-flash, diff its findings vs the published High/Med list, emit one number: "rediscovered X of Y."
- **Value:** the entire $1M audit thesis lives or dies on this hit-rate. 0/Y kills the asset for $0; 2-3/Y gives a measured EV to size against.
- **Honesty:** UNVALIDATED — this IS the test. Highest-upside item because it's the only one pointing at a mechanic we haven't already disproven.

**3. CustomTokenDeployer — inbound-demand counter** *(NEEDS validation; cheap)*
- KV counter on every endpoint hit (discovered → quoted → paid), daily GLM rollup. Kill bar: first nonzero PAID request; 7-day zero = shelve. Measures real demand at ~$0.

**4. Consolidated "is-anything-alive / recoverable" one-shot sweep** *(VALIDATED reads; run ONCE)*
- One job replacing five duplicate probes: getLogs non-deployer swaps + claimable-fee reads + withdrawable LP-leg value across the deployer's pools, count only non-deployer wallets, net out gas. **One-shot, not a perpetual cron babysitting a corpse.**

**5. PairWithThryx — recoverable-liquidity audit** *(VALIDATED reads; one-shot + on-demand)*
- Read positions across 51 V4 pools, compute withdrawable legs minus gas, queue a `decreaseLiquidity/collect` bundle for one-tap consent on net-positive positions. Recovery, not revenue. Money-OUT stays gated.

## 3. Traps we're NOT doing

- Zero-cost infra migration of the dead launchpad (cost-cut of a corpse ≠ demand).
- Fee-checker leaderboards + SEO (build-it-and-they-come, no validated traffic).
- WebsiteCompany Stripe-link audit (Stripe hard-banned — PayPal only).
- Multi-token claim sweepers built BEFORE a claimable read returns nonzero.
- RestaurantForAI "manufacture one test order" (self-buy with extra steps).
- Audit contest radar / draft pre-writer (downstream of #2 — build only if it passes).
- Perpetual fee-monitor crons on wound-down protocols (one-shot read, don't stand up forever-crons on a corpse).

## 4. Foundation gaps (add to glm-aio to unlock the above)

- **Email-send tool** — Gmail draft→send so an agent can alert Anthony directly.
- **PushNotification + consent-approve link** — build-signed-tx → push-with-approve-URL → broadcast-on-tap. The GATED on-chain pattern every harvester depends on.
- **ThryxBaseRPC read client + Multicall3 batcher + getLogs windower** — shared chain-read spine.
- **R2/KV snapshot store** — diff-against-prior-state primitive (Watchdog needs it). *(KV is now wired.)*
- **GitHub API push tool** — commit as `lordbasilaiassistant-sudo` only, pre-push identity guard.
- **PayPal `create_invoice` wiring** — approved cash rail (never Stripe).
- **Scheduler abstraction** — wrap CronCreate/Delete so a flow self-pauses its cron on a kill verdict. Default new probes to one-shot.

**Bottom line:** build #1 (real + useful today); run #2 and #4 ($0, answer the only open questions). Don't build any harvester or fulfillment runner until a probe returns a cited nonzero number.
