# E2 Bottleneck ranking, with evidence

**Source:** `BASELINE.md`, 3 real briefs plus 2 instrumented research runs.

---

## The finding that reorders everything

**There is one bottleneck. Research is 98.9-99.0% of build wall time, and the
CLI call is 99.6-100% of research.** Everything else in the pipeline combined --
spec, compose, build, verify, record, and all inter-stage idle -- is about 1% of
a build.

This means most classic pipeline optimizations are unavailable here, not because
they are hard, but because **there is no time in those places to recover.**

## Ranked sinks

### 1. The research CLI invocation — 113,000-180,000ms per build (~99%)

**Cost:** the whole build, effectively. **Why:** one synchronous CLI call does
search, fetch, and synthesis in a single turn; wall time scales with how much the
model chooses to search, which is why it ranges 113s-180s for equivalent briefs.
**Candidate fixes:** (a) run briefs concurrently -- the cost is wall-clock and
network-bound, not CPU-bound, so it parallelizes almost perfectly; (b) route
research to a cheaper brain if one passes the gate. Both tested in E3/E4.

### 2. The verify stage — 1,184-1,861ms per build (~1%)

**Cost:** ~1.5s. **Why:** real Playwright browser verification. **Candidate fix:**
none worth taking. It is the only thing standing between a build and an unchecked
site, and 1.5s is a bargain for it. **Explicitly not optimizing this.**

### 3. Source verification inside research — 1-495ms (~0.4% at worst)

**Cost:** half a second on a 3-source packet. **Why:** already parallelized with
`Promise.all` over distinct URIs, capped at 20. **Candidate fix:** none. See the
refuted list below regarding caching.

### 4. All remaining pipeline stages combined — under 50ms (~0.03%)

spec (8-17ms), build (7-10ms), compose (0-1ms), record (1ms). **Candidate fix:**
none available. Parallelizing every one of these to zero would save under 50ms of
a 120,000ms build.

### 5. Inter-stage idle — 5-8ms per run (~0.006%)

The pipeline's own orchestration overhead. **Effectively zero.** Recorded to close
the question, not because it is actionable.

---

## Candidates the evidence REFUTES

Stated plainly, because these were the expected answers and the numbers do not
support them.

**"Media slots should fill concurrently: 11 slots x 3s should be ~3s not ~33s."**
There is no 33s. **Nothing fills media slots.** The imagery bridge declares them
(10-11 per site) and generation is not wired, by the standing no-API-key rule.
Available saving today: **zero**. This becomes a real and correct optimization the
moment generation is wired, and should be built parallel from the start.

**"Research non-determinism forcing retries."** **Zero retries across every
baseline run.** The empty-packet retry added earlier fired zero times here.
Non-determinism is real, but it varies the *fact count* (0, 6, 7, 8 on the same
brief), not the retry count. It costs quality variance, not time.

**"Expensive-brain stages doing cheap work."** **Only one of six stages uses a
brain at all.** The other five are deterministic and cost nothing. There is no
expensive brain doing cheap work today; the roster spec is where this becomes
possible, and it is not wired.

**"Repair loops re-running whole stages instead of failed units."** **No repair
loop exists yet.** It is spec'd in the roster, not built. Cost today: zero.

**"Prompt reuse across stages instead of rebuilding context."** **Only one stage
issues a prompt.** There is nothing to reuse.

**"Cache verified facts by content hash so a retry never re-fetches."** Source
verification is 1-495ms of a ~120,000ms build. **Maximum possible saving: 0.4%,**
and only on a retry, which happens ~0% of the time. The cache would cost more in
invalidation complexity than it could ever return. **Recommend not building it.**

---

## What E2 convicts

Exactly one thing, two ways to attack it:

1. **Builds run one at a time.** The bottleneck is wall-clock and network-bound,
   so concurrency is nearly free. Measured in E4.
2. **Research may be routed to a cheaper brain.** Measured in E3.

Everything else on the candidate list is either already optimal, too small to
matter, or does not exist yet.
