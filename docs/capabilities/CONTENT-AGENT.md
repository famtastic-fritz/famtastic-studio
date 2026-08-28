# Capability record: the content/art-direction agent

**Asked:** find the agent handling shape, texture and visual treatment; write its
capability record; decide call-across-the-seam vs port.

## What was actually found

There is **no single content agent**. The capability Fritz is describing is real
and effective, but it is distributed across four things, only one of which is a
formal artifact:

### 1. `skills/image-and-video-gen` — the substantive one
`~/Development/FAMtastic/skills/image-and-video-gen/SKILL.md`, status `draft`.

A model-selection and production discipline for visual assets. Its decision tree
is the part Studio most needs:

| Task | Model | Cost |
|---|---|---|
| Hero still, final photoreal | gpt-image-2 high | ~$0.17/img |
| Hero still, broad iteration | Imagen 4.0 | ~$0.004/img |
| New pose for existing mascot | gpt-image-2 edit + multi-anchor | ~$0.17/img |
| Lighting variant of a scene | gpt-image-2 edit | ~$0.17/img |
| Transparent cutout | Imagen/gpt-image-2 + BiRefNet matte | pipeline |
| Ambient scene motion | Veo 3.1 Lite i2v | $0.05/sec |
| Character animation, identity locked | Vidu Q3 Turbo r2v, up to 7 refs | $0.034/sec |
| Ambient UI motion | **CSS/SVG/Lottie, no generation** | **$0** |

Beyond the table it carries: the **multi-image character anchor pattern** for
identity locking across new poses, a two-stage transparent extraction (native
attempt, then BiRefNet alpha matting), per-provider gotchas that waste budget,
and hard rules including cost caps, approval before spend, no keys in files, and
alpha/dimension verification on every output.

**The single most valuable line in it:** *"if CSS keyframes can fake the motion,
don't pay for video."* That is art direction as a cost decision, and Studio's
imagery stage has no equivalent judgement — it treats every slot as a generation
request.

### 2. `STANDING-FINDING-art-direction.md` — the diagnosis
Ratified 2026-08-25. Establishes that the gap is **not generation**: the imagery
adapter already produces credible editorial photography. What it cannot produce
is a character with stable identity across media, a consistent scene language,
motion as a first-class asset, and the upstream decision about what the site
should *look like* at all. Explicitly assigns this to the creative-direction
stage, not the imagery stage.

### 3. Legacy `site-studio/server.js` — the working implementation
- **Restyle mode** (`:16756`): changes colors, fonts, layout, motion, decorative
  shapes while *preserving all content*; explicitly forbids rewriting copy,
  adding/removing sections, or changing nav/CTAs. A genuine separation of visual
  treatment from content that studio-next does not have.
- **`design_dna`** (`:4714`): `style_fingerprint`, `layout_variant`,
  `font_pairing`, `media_fulfillment`, `content_verification`.
- **`server/proof-media-fulfillment.js`**: slot-based fulfillment recording
  `provider: 'imagen4'` per asset.

### 4. `docs/marketing/CONTENT-QA-AGENT-CONTRACT.md` — QA, not direction
Present in three worktrees. Content quality assurance, adjacent but not the
treatment engine.

## Why it has been effective

It encodes **decisions made before a prompt is written**: which model for which
job, when not to generate at all, how identity is held constant across assets,
and what "visual treatment" is allowed to change. Studio's imagery stage begins
one step too late — it receives a prompt and fills a slot.

## Recommendation: **port the decision layer, call across the seam for execution**

Not a single choice, because the capability has two halves with opposite
economics.

**Port into Studio (the decision layer).** The decision tree, the
CSS-before-video rule, identity-anchor handling, cost caps and approval
thresholds, and the restyle/content separation. These are **judgement, not
credentials** — cheap to move, no secrets, and they must sit next to the
imagery stage to be consulted. Porting them is what turns "generates images"
into "has art direction."

**Call across the seam (execution).** The paid providers (gpt-image-2, Imagen,
Veo, Vidu) sit behind credentials the Designs worker holds. Studio should call a
worker, not hold a key. This respects the subscriptions-not-keys rule and the
2026-05-05 vault ruling simultaneously.

**Do not port the credential.** That is the accident that made preview generation
look like it belonged to Designs.

## Honest gaps in this record

- The skill is `status: draft` and its costs are unverified against current
  provider pricing.
- Nothing here supplies **commissioned** art direction. The standing finding is
  explicit that a mascot with a stable identity is a directorial commission, not
  a pipeline output. Porting this closes the *decision* gap, not that one.
- The restyle mode has never been run against studio-next output.
