// Small card render helper.

// The Shay card types this console knows how to render structurally
// (PHASE-2-CONTRACTS.md section 2, BINDING). Kept in sync by hand with
// server/kernel/cards.js CARD_TYPES -- the two cannot share a module across
// the server/public boundary in this zero-build-step tree, so this list is
// the frontend's own source of truth for "known" vs "unsupported".
export const KNOWN_CARD_TYPES = Object.freeze([
  "plan",
  "proposal",
  "diff",
  "confirm",
  "progress",
  "success",
  "failure",
  "recovery",
  "deploy_receipt",
]);

export function card({ title, meta, body }) {
  const el = document.createElement("div");
  el.className = "card";

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "card__title";
    titleEl.textContent = title;
    el.appendChild(titleEl);
  }

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "card__meta";
    metaEl.textContent = meta;
    el.appendChild(metaEl);
  }

  if (body instanceof Node) {
    el.appendChild(body);
  } else if (typeof body === "string") {
    const bodyEl = document.createElement("div");
    bodyEl.textContent = body;
    el.appendChild(bodyEl);
  }

  return el;
}

// Renders a typed Shay card structurally -- never as flattened prose. An
// unknown type (not in KNOWN_CARD_TYPES) renders an explicit unsupported
// state showing the raw type, rather than being dropped or guessed at.
// `onAction(action, cardObj)` is called when the operator confirms (or, for
// an action with confirm_required: false, immediately clicks) an action
// button; this function never fires the action itself.
export function renderCard(cardObj, { onAction } = {}) {
  const el = document.createElement("div");

  if (!cardObj || typeof cardObj !== "object" || !KNOWN_CARD_TYPES.includes(cardObj.type)) {
    el.className = "shay-card shay-card--unsupported";
    const head = document.createElement("div");
    head.className = "shay-card__title";
    const rawType = cardObj && typeof cardObj === "object" ? cardObj.type : undefined;
    head.textContent = `Unsupported card type: ${rawType === undefined ? "(missing)" : String(rawType)}`;
    el.appendChild(head);
    const note = document.createElement("div");
    note.className = "shay-card__body";
    note.textContent = "This console does not know how to render this card. Nothing was dropped -- the raw type is shown above.";
    el.appendChild(note);
    return el;
  }

  el.className = `shay-card shay-card--${cardObj.type} shay-card--state-${cardObj.state || "pending"}`;

  const head = document.createElement("div");
  head.className = "shay-card__head";
  const type = document.createElement("span");
  type.className = "shay-card__type";
  type.textContent = cardObj.type;
  const state = document.createElement("span");
  state.className = "shay-card__state";
  state.textContent = cardObj.state || "pending";
  head.append(type, state);
  el.appendChild(head);

  if (cardObj.title) {
    const title = document.createElement("div");
    title.className = "shay-card__title";
    title.textContent = cardObj.title;
    el.appendChild(title);
  }

  if (cardObj.body) {
    const body = document.createElement("div");
    body.className = "shay-card__body";
    body.textContent = cardObj.body;
    el.appendChild(body);
  }

  const evidence = Array.isArray(cardObj.evidence) ? cardObj.evidence : [];
  const evidenceWrap = document.createElement("div");
  evidenceWrap.className = "shay-card__evidence";
  if (evidence.length) {
    const label = document.createElement("div");
    label.className = "shay-card__evidence-label";
    label.textContent = "Evidence";
    evidenceWrap.appendChild(label);
    const list = document.createElement("ul");
    for (const item of evidence) {
      const li = document.createElement("li");
      li.textContent = item.note ? `${item.kind}: ${item.ref} (${item.note})` : `${item.kind}: ${item.ref}`;
      list.appendChild(li);
    }
    evidenceWrap.appendChild(list);
  } else {
    const label = document.createElement("div");
    label.className = "shay-card__evidence-label shay-card__evidence-label--empty";
    label.textContent = "No evidence attached to this card.";
    evidenceWrap.appendChild(label);
  }
  el.appendChild(evidenceWrap);

  const actions = Array.isArray(cardObj.actions) ? cardObj.actions : [];
  if (actions.length) {
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "shay-card__actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn shay-card__action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        if (action.confirm_required) {
          const ok = window.confirm(`${action.label}\n\nThis will change: ${action.label}. Confirm to proceed.`);
          if (!ok) return;
        }
        if (typeof onAction === "function") onAction(action, cardObj);
      });
      actionsWrap.appendChild(btn);
    }
    el.appendChild(actionsWrap);
  }

  return el;
}
