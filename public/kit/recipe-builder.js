// Visual Recipe Builder & Stage DAG Node Ladder (public/kit/recipe-builder.js)
// Renders an interactive pipeline stage DAG with role routing per stage,
// extracted variable inputs, and a 1-click execution trigger.

const ENGINE_ROLES = [
  { id: "lead-architect", label: "Lead Architect" },
  { id: "spec-composer", label: "Spec Composer" },
  { id: "creative-director", label: "Creative Director" },
  { id: "code-specialist", label: "Code Specialist" },
];

const DEFAULT_RECIPE_STAGES = [
  { stage: "spec", role: "lead-architect", depends_on: [], verifier: "spec-schema-v1" },
  { stage: "copywriting", role: "creative-director", depends_on: ["spec"], verifier: "tone-brand-v1" },
  { stage: "imagery", role: "creative-director", depends_on: ["spec"], verifier: "webp-opt-v1" },
  { stage: "primitives", role: "code-specialist", depends_on: ["copywriting", "imagery"], verifier: "css-token-v2" },
  { stage: "shadow_diff", role: "lead-architect", depends_on: ["primitives"], verifier: "gate-six-lane" },
];

export function renderRecipeDag(recipeData = null, { onRun } = {}) {
  const container = document.createElement("div");
  container.className = "recipe-dag";

  const stages = recipeData?.stages?.length ? recipeData.stages : DEFAULT_RECIPE_STAGES;
  const recipeName = recipeData?.name || "Standard Visual Assembly";
  const recipeVer = recipeData?.version ? `v${recipeData.version}` : "v1.0 (interactive)";

  // --- Title Bar ---
  const header = document.createElement("div");
  header.className = "fam-section__title";
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.innerHTML = `<span>Stage Pipeline: <strong>${recipeName}</strong></span> <span class="card__meta">${recipeVer}</span>`;
  container.appendChild(header);

  // --- Stage Ladder (DAG) ---
  const ladder = document.createElement("div");
  ladder.className = "recipe-dag__ladder";

  stages.forEach((st, idx) => {
    const node = document.createElement("div");
    node.className = "recipe-dag__node";

    const head = document.createElement("div");
    head.className = "recipe-dag__node-head";

    const title = document.createElement("span");
    title.className = "recipe-dag__node-title";
    title.textContent = st.stage || `Stage ${idx + 1}`;

    const stepNum = document.createElement("span");
    stepNum.className = "card__meta";
    stepNum.textContent = `#${idx + 1}`;
    head.append(title, stepNum);

    const roleSelect = document.createElement("select");
    roleSelect.className = "recipe-dag__input";
    roleSelect.style.padding = "2px 4px";
    roleSelect.style.fontSize = "0.72rem";

    for (const opt of ENGINE_ROLES) {
      const el = document.createElement("option");
      el.value = opt.id;
      el.textContent = opt.label;
      if (st.role === opt.id || (st.model && st.model.includes(opt.id.slice(0, 4)))) el.selected = true;
      roleSelect.appendChild(el);
    }

    const verifierChip = document.createElement("span");
    verifierChip.className = "card__meta";
    verifierChip.style.fontSize = "0.68rem";
    verifierChip.textContent = `✓ ${st.verifier_version || st.verifier || "verified"}`;

    node.append(head, roleSelect, verifierChip);
    ladder.appendChild(node);

    if (idx < stages.length - 1) {
      const arrow = document.createElement("div");
      arrow.className = "recipe-dag__arrow";
      arrow.innerHTML = "&#8594;";
      ladder.appendChild(arrow);
    }
  });

  container.appendChild(ladder);

  // --- Parameter Extraction & Run Form ---
  const form = document.createElement("form");
  form.className = "recipe-dag__form";

  const fields = [
    { id: "business_name", label: "Business / Site Name", default: "MBSH Reunion 1996" },
    { id: "primary_color", label: "Primary Brand Color", default: "#C8102E (Scarlet)" },
    { id: "tone_directive", label: "Tone Directive", default: "Prestigious, nostalgic, celebratory" },
  ];

  for (const f of fields) {
    const wrap = document.createElement("div");
    wrap.className = "recipe-dag__field";

    const label = document.createElement("label");
    label.className = "recipe-dag__label";
    label.textContent = f.label;

    const input = document.createElement("input");
    input.className = "recipe-dag__input";
    input.name = f.id;
    input.value = f.default;

    wrap.append(label, input);
    form.appendChild(wrap);
  }

  const runBtn = document.createElement("button");
  runBtn.type = "submit";
  runBtn.className = "btn btn--primary";
  runBtn.style.alignSelf = "end";
  runBtn.textContent = "⚡ Run Workflow via Swarm";

  form.appendChild(runBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const params = Object.fromEntries(formData.entries());
    runBtn.disabled = true;
    runBtn.textContent = "Dispatching to Shay...";

    setTimeout(() => {
      runBtn.disabled = false;
      runBtn.textContent = "⚡ Run Workflow via Swarm";
      if (typeof onRun === "function") onRun(recipeData, params);
    }, 400);
  });

  container.appendChild(form);

  return container;
}
