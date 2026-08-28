// Constants shared between pipeline.js and pipeline-batch.js. Separated so the
// batch module does not import the pipeline (which would import it back).

// Batch concurrency. Default 3 is deliberately conservative: it was the measured
// configuration (2.39x with no contention on three real briefs) and it keeps a
// subscription CLI well clear of any rate limit. The ceiling exists so a caller
// cannot fan out to hundreds of live CLI processes on the operator's machine.
export const DEFAULT_BATCH_CONCURRENCY = 3;
export const MAX_BATCH_CONCURRENCY = 8;

// Per-page copy concurrency. The copy stage spawns a CLI once PER PAGE, and it
// ran serially: on an eight-page build that was eight sequential calls and the
// spec stage measured 266-338s, 70-74% of a build. Research, long assumed to be
// the whole cost, was 26-29% of the same runs.
//
// Default 3 matches DEFAULT_BATCH_CONCURRENCY for the same measured reason: it
// is the configuration that produced 2.39x on real briefs with no contention,
// and it keeps a subscription CLI clear of a rate limit. The imagery adapter
// independently settled on 2 after hitting HTTP 429 at higher fan-out, so 3 is
// the conservative end of what is known to work rather than a guess.
export const DEFAULT_COPY_CONCURRENCY = 3;
export const MAX_COPY_CONCURRENCY = 8;
