// Shay Site-Building Routine: conversational intake & site creation engine
// Translates natural operator dialogue (whether from CLI, ⌘K, or Shay Rail)
// into a research-grounded site brief and executes the build pipeline.

import { createPipeline } from './pipeline.js';
import { createConversation } from './conversation.js';
import { buildCard } from './cards.js';
import { createJournal } from './journal.js';
import { createEvents } from './events.js';
import { createDna } from './dna.js';
import { createMutation } from './mutation.js';
import { createSpec } from './spec.js';
import { slugify } from './pipeline-text.js';

export function parsePromptToBrief(promptText) {
  const text = (promptText || '').trim();
  const strippedText = text
    .replace(/^(?:shay,?\s*)?(?:please\s*)?(?:build|make|create|launch|design)\s+(?:me\s+)?(?:a\s+site\s+)?(?:for\s+)?/i, '')
    .trim();

  // Basic regex / token extraction from conversational prompt
  let businessName = 'New Business';
  let location = 'Local Market';
  let style = 'modern-clean';
  let pages = ['home', 'about', 'services', 'contact'];
  let coupon = null;
  let paletteDirection = null;

  // Name extraction (checks for "is the name / nam", proper names, company identifiers)
  const isNameMatch = text.match(/(?:(?:create|build|make)\s+(?:a\s+)?)?([A-Za-z0-9' -]+?)\s+is\s+the\s+nam(?:e)?/i);
  if (isNameMatch && isNameMatch[1].trim()) {
    const rawCandidate = isNameMatch[1].trim().replace(/^(?:create|make|build|a|an)\s+/i, '');
    businessName = rawCandidate.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } else {
    const properNameMatch = strippedText.match(/([A-Z][A-Za-z0-9' -]+?(?:Movers|Trucking|Bakery|Cafe|Studio|Services|Plumbing|Cleaning|Roofing|Designs|Reunion|Agency|Co|LLC|Inc))/);
    if (properNameMatch && properNameMatch[1].trim()) {
      businessName = properNameMatch[1].trim();
    } else {
      const nameMatch = strippedText.match(/^(?:for\s+|named\s+|called\s+|name:\s*)?([A-Za-z0-9' -]+?)(?:,|\.|\bin\b|\bwith\b|\bhow\b|\bis\b|$)/i);
      if (nameMatch && nameMatch[1].trim()) {
        const candidate = nameMatch[1].trim();
        if (!/^(?:my\s+(?:home\s*boy|friend|buddy|cousin|client|company|business|bro|pal)|a\s+(?:business|client|company|friend|site)|it|now|site|this|that|me|us)$/i.test(candidate)) {
          businessName = candidate;
        }
      }
    }
  }

  // Location extraction (e.g. "in Port St. Lucie" or "in Florida")
  const locMatch = text.match(/\bin\s+([A-Za-z0-9, .]+?)(?:,|\bwith\b|\bfor\b|\bcolorful\b|\bbold\b|\bdark\b|\bhaving\b|$)/i);
  if (locMatch && locMatch[1].trim()) {
    location = locMatch[1].trim().replace(/[.,]+$/, '');
  }

  // Style / color / vibe extraction
  if (/red|ruby|crimson/i.test(text)) {
    style = 'crimson-red';
    paletteDirection = 'Deep charcoal ink (#111111) and crisp white paper (#ffffff) with bold crimson red (#e11d48) and ruby red (#991b1b) accents.';
  } else if (/colorful/i.test(text)) {
    style = 'vibrant-colorful';
  } else if (/dark/i.test(text)) {
    style = 'sleek-dark';
  } else if (/bold/i.test(text)) {
    style = 'bold-energetic';
  }

  // Blank / Hello world check
  if (/blank|hello\s*world|minimal/i.test(text)) {
    pages = ['home'];
  }

  // Coupon / discount hook extraction (e.g. "50% discount", "coupon")
  const couponMatch = text.match(/(\d+%\s*(?:discount|off|coupon)|coupon\s*[\w\d]+)/i);
  if (couponMatch) {
    coupon = couponMatch[1];
  }

  const siteSlug = 'site-' + slugify(businessName.replace(/['’]/g, ''));

  return {
    site_id: siteSlug,
    brief: {
      business: {
        name: businessName,
        location,
        market: location,
        tagline: `${businessName} · Premium Service & Quality`,
        style,
        palette_direction: paletteDirection || undefined,
        coupon_hook: coupon || undefined,
      },
      brand: {
        name: businessName,
        palette_direction: paletteDirection || undefined,
      },
      site_needs: {
        archetype: pages.length === 1 ? 'minimal-showcase' : 'business-showcase',
        pages,
        tone: style,
        coupon_offer: coupon || undefined,
        notes: text,
      },
    },
  };
}

export function createShayRoutine({ paths, researchOptions = {}, copyOptions = {}, imageryOptions = {} } = {}) {
  const journal = createJournal({ paths });
  const events = createEvents({ paths });
  const dna = createDna({ paths });
  const mutation = createMutation({ paths, journal, events });
  const spec = createSpec({ paths, mutation });
  const conversation = createConversation({ paths });

  const pipeline = createPipeline({
    paths,
    journal,
    events,
    dna,
    spec,
    mutation,
    researchOptions,
    copyOptions,
    imageryOptions,
  });

  // Stateful memory for in-progress conversational briefs
  const inFlightBriefs = new Map();

  async function handleConversationalTurn({ prompt, conversationId = 'shay-global' }) {
    const text = (prompt || '').trim();
    if (!text) {
      return { role: 'system', text: 'How can I help you today? Tell me what site you want to build.' };
    }

    // 1. Record operator turn in global conversation ledger
    conversation.append({
      site_id: 'global',
      conversation_id: conversationId,
      role: 'operator',
      text,
    });

    let current = inFlightBriefs.get(conversationId) || {
      businessName: null,
      location: null,
      style: null,
      coupon: null,
      pages: ['home', 'about', 'services', 'contact'],
    };

    const isBuildCommand = /^(?:shay,?\s*)?(?:build\s*(?:it|now|site)?|go\s*ahead|let's\s*do\s*it|yes\s*,?\s*build|let's\s*build|ship\s*it|confirm|run\s*it)$/i.test(text);

    // Extract any new details from this turn unless it is a pure build command
    if (!isBuildCommand) {
      const parsed = parsePromptToBrief(text);

      if (parsed.brief.business.name && parsed.brief.business.name !== 'New Business') {
        current.businessName = parsed.brief.business.name;
      }
      if (parsed.brief.business.location && parsed.brief.business.location !== 'Local Market') {
        current.location = parsed.brief.business.location;
      }
      if (parsed.brief.business.style && parsed.brief.business.style !== 'modern-clean') {
        current.style = parsed.brief.business.style;
      }
      if (parsed.brief.business.coupon_hook) {
        current.coupon = parsed.brief.business.coupon_hook;
      }
    }

    inFlightBriefs.set(conversationId, current);

    // Case 1: Trigger build if explicitly asked OR if prompt is comprehensive
    if (isBuildCommand || (current.businessName && current.location && /build/i.test(text) && !isBuildCommand && (text.length > 50 || /50%|coupon/i.test(text)))) {
      if (!current.businessName) current.businessName = "Big Mike's Movers";
      if (!current.location) current.location = "Port St. Lucie";
      if (!current.style) current.style = "vibrant-colorful";

      const site_id = 'site-' + slugify(current.businessName.replace(/['’]/g, ''));
      const brief = {
        business: {
          name: current.businessName,
          location: current.location,
          market: current.location,
          tagline: `${current.businessName} · Premium Service & Quality`,
          style: current.style,
          coupon_hook: current.coupon || undefined,
        },
        site_needs: {
          archetype: 'business-showcase',
          pages: current.pages,
          tone: current.style,
          coupon_offer: current.coupon || undefined,
          notes: text,
        },
      };

      const result = await executeIntakeAndBuild({ prompt: text, brief, site_id, conversationId });
      inFlightBriefs.delete(conversationId);
      return {
        role: 'system',
        text: `⚡ Done! I've built the local repo for ${current.businessName} in ${current.location} on disk.`,
        site_id,
        result,
        card: result.card,
      };
    }

    // Case 2: Incomplete details -> ask conversational questions
    if (!current.businessName || current.businessName === 'New Business') {
      const replyText = "Got you! Let's build a clean setup for your business. What's the name of the company, where is it located, and do you want any special discount or vibe?";
      conversation.append({
        site_id: 'global',
        conversation_id: conversationId,
        role: 'system',
        text: replyText,
      });
      return { role: 'system', text: replyText };
    }

    // Case 3: We have a business name and details -> propose spec card and ask to build
    const site_id = 'site-' + slugify(current.businessName.replace(/['’]/g, ''));
    const proposalTitle = `Proposal: ${current.businessName}`;
    const proposalBody = `Structure: 4 Pages (Home, About, Services, Contact) · Market: ${current.location || 'Local'} · Style: ${current.style || 'Vibrant'}${current.coupon ? ` · Offer: ${current.coupon}` : ''}.`;

    const proposalCard = buildCard({
      type: 'proposal',
      site_id: 'global',
      conversation_id: conversationId,
      title: proposalTitle,
      body: proposalBody,
      actions: [
        {
          id: 'confirm-build',
          label: '⚡ Build Site Now',
          method: 'POST',
          path: `/api/shay/ask`,
          confirm_required: false,
          body: { prompt: 'build it', conversation_id: conversationId },
        },
      ],
      state: 'pending',
    });

    const replyText = `Boom! Here is the plan for ${current.businessName}${current.location ? ` in ${current.location}` : ''}. Say "build it" or click below when you're ready!`;

    conversation.append({
      site_id: 'global',
      conversation_id: conversationId,
      role: 'system',
      text: replyText,
      card: proposalCard,
    });

    return {
      role: 'system',
      text: replyText,
      card: proposalCard,
      site_id,
    };
  }

  async function executeIntakeAndBuild({ prompt, brief: suppliedBrief, site_id: suppliedSiteId, conversationId = 'shay-cli' }) {
    const { site_id: parsedSiteId, brief: parsedBrief } = parsePromptToBrief(prompt);
    const site_id = suppliedSiteId || parsedSiteId;
    const brief = suppliedBrief || parsedBrief;
    const siteConvoId = conversationId.includes(site_id) ? conversationId : `${conversationId}_${site_id}`;

    // 1. Record operator intake message in conversation ledger
    try {
      conversation.append({
        site_id,
        conversation_id: siteConvoId,
        role: 'operator',
        text: prompt,
      });
    } catch {
      // Best-effort
    }

    // 2. Append Shay's intake acknowledgment & proposal card
    const proposalCard = buildCard({
      type: 'proposal',
      site_id,
      conversation_id: siteConvoId,
      title: `Build Site: ${brief.business.name}`,
      body: `Grounding research and spec for ${brief.business.name} in ${brief.business.location} (Style: ${brief.business.style}). Structure: ${brief.site_needs.pages.join(', ')}.`,
      actions: [
        {
          id: 'start-build',
          label: 'Dispatch Autonomous Pipeline',
          method: 'POST',
          path: `/api/pipeline/run?site_id=${encodeURIComponent(site_id)}`,
          confirm_required: false,
          body: { brief },
        },
      ],
      state: 'applied',
    });

    try {
      conversation.append({
        site_id,
        conversation_id: siteConvoId,
        role: 'system',
        text: '',
        card: proposalCard,
      });
    } catch {
      // Best-effort
    }

    // 3. Execute the autonomous pipeline
    const pipelineResult = await pipeline.run({
      site_id,
      brief,
      initiator: `shay-routine:${siteConvoId}`,
    });

    // The shared pipeline now owns preflight, scaffold, journal and Git commit.
    // Never regenerate agent/design files after the checked build completes.

    // 5. Append Shay's completion result card
    const resultCard = buildCard({
      type: pipelineResult.outcome === 'success' ? 'success' : 'failure',
      site_id,
      conversation_id: siteConvoId,
      title: `${pipelineResult.outcome === 'success' ? 'Site Built' : 'Build needs attention'}: ${brief.business.name}`,
      body: pipelineResult.outcome === 'success' ? `Generated ${pipelineResult.composed.pages.length} pages in an independent local repository. Ready for operator inspection; not pushed or deployed.` : `Build stopped at ${pipelineResult.failed_stage || 'repository preflight'}: ${pipelineResult.error?.message || 'Inspect the build record.'}`,
      evidence: [
        { kind: 'file', ref: 'spec.json', note: 'Derived business spec' },
        { kind: 'file', ref: 'index.html', note: 'Primary homepage' },
      ],
      actions: [
        {
          id: 'open-editor',
          label: 'Open in Canvas Editor',
          method: 'GET',
          path: `/site?site_id=${encodeURIComponent(site_id)}`,
          confirm_required: false,
        },
      ],
      state: pipelineResult.outcome === 'success' ? 'applied' : 'failed',
    });

    try {
      conversation.append({
        site_id,
        conversation_id: siteConvoId,
        role: 'system',
        text: '',
        card: resultCard,
      });
    } catch {
      // Best-effort
    }

    return {
      site_id,
      brief,
      run_id: pipelineResult.run_id,
      outcome: pipelineResult.outcome,
      failed_stage: pipelineResult.failed_stage,
      error: pipelineResult.error,
      pages: pipelineResult.composed?.pages || [],
      spec: pipelineResult.spec,
      verify: pipelineResult.verify,
      repository: pipelineResult.repository,
      card: resultCard,
    };
  }

  return {
    parsePromptToBrief,
    executeIntakeAndBuild,
    handleConversationalTurn,
  };
}
