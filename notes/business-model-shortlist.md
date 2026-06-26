# Flash-Company Business Model — Honest Shortlist (2026-06-26)

> 25-agent crew: 18 ideated → 4 survived → 14 killed. Constraints: flash-doable verifiable work,
> built-in marketplace distribution, PayPal/bank payout (no Stripe), productized, no capital, no peopling by Anthony.

## TLDR
Best (borderline) bet: **Etsy digital-download bookkeeping/reconciler spreadsheets for online sellers**
(payout reconcilers, deposit managers, true-profit calculators). Money already changes hands for this exact thing,
the buyer searches the marketplace (zero peopling), and the deliverable is pure formula logic flash provably nails.
**Honest scale:** ~$0 for 1-3 months, then $0–150/mo *if a listing ranks*; most-likely $0 if the cover image is weak.
Lunch money, not salary.

## The decision you must make first: payout rail
- **Etsy** pays **ACH to a US bank** — clears "no Stripe", but is NOT literal PayPal. Best traffic.
- **Gumroad** pays **PayPal** directly — but weak Discover traffic.
- → If "PayPal" was literal, it's Gumroad (weak traffic). If "PayPal" meant "not Stripe", Etsy→bank is fine and stronger.

## Top 3 survivors
1. **Etsy seller-facing bookkeeping/reconciler sheets** — flash makes the .xlsx/Sheet (XLOOKUP/QUERY/SUMIFS, CSV import+dedupe+categorize, conditional formats, how-to tab). 100% verifiable. Buyers via Etsy search (validated: Someka, Paper&Spark already sell this). Payout Etsy→bank. **Risk: Etsy ranks on THUMBNAIL — flash can't make it; that's Claude's job (staged screenshot of the real sheet).**
2. **Gumroad tested dev packs** (regex+fixtures, runnable SQL libs, CSV↔JSON↔XLSX scripts) — line-by-line verifiable. Payout = PayPal. **Risk: soft demand (devs can LLM-generate these); weak traffic → most likely $0.**
3. **Etsy niche public-data reference sheets** (USDA markets, plant-hardiness-by-ZIP, nutrition) — flash cleans public data into tidy tables. **Risk: Etsy skews aesthetic; stale data → bad reviews; same thumbnail gate.**

## The two repeat killers (why 14 died)
- **Etsy is design-gated** — the thumbnail wins the sale, and flash can't make one.
- **Gumroad is bring-your-own-audience.**
Survivors only survive *if* Claude can make a thumbnail that ranks (Etsy) or *if* we accept thin traffic (Gumroad).

## The $0 test to run FIRST (no listing fee, no ad spend)
1. **Demand probe:** search Etsy `etsy payment reconciler spreadsheet`, `bookkeeping spreadsheet for sellers`. Top ~15 listings — read public review counts. Pass = several with 300+ reviews AND recent (last-30-day) reviews. Fail = mostly <20 or all 2+ yrs old → kill the lane.
2. **Quality probe:** flash builds ONE reconciler sheet from a sample seller CSV; manually verify every number computes (no #REF/#N/A). (Flash's proven CSV class — expect pass.)
3. **Image gate (the real risk):** Claude makes ONE cover thumbnail from a staged screenshot; compare side-by-side vs the top 5 ranked listings. If it visibly loses → STOP. Distribution will never amplify it.

## Honest verdict
**Borderline-viable, not clearly viable.** Work-ceiling / payout / capital / shape constraints are clean; **distribution is the coin-flip**, and the load-bearing unknown is **design taste for the listing image** — a model-capability gap the flywheel (better models) closes. The *market is real and proven*; the *execution is gated on a capability we expect to improve*. So: run the $0 market+image test now; if the thumbnail loses, **shelve execution until the design gap narrows — do NOT grind out 20 mediocre listings** (that's the 21-deploys/$0 pattern in spreadsheet form).
