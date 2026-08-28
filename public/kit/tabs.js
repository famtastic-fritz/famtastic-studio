// Minimal ARIA tabs widget (tablist/tab/tabpanel pattern, roving tabindex,
// arrow/home/end keyboard navigation). Panel content is built lazily: the
// first time a tab is activated, buildPanel(id, panelEl) is called once to
// populate it; later activations just toggle visibility.
//
// createTabs({ tabs: [{ id, label }], initialId, buildPanel, onChange })
// returns { tablist, panelsWrap, activate(id) }.

export function createTabs({ tabs, initialId, buildPanel, onChange }) {
  if (!Array.isArray(tabs) || !tabs.length) throw new Error("createTabs requires at least one tab");

  const tablist = document.createElement("div");
  tablist.className = "tabs__list";
  tablist.setAttribute("role", "tablist");

  const panelsWrap = document.createElement("div");
  panelsWrap.className = "tabs__panels";

  const buttons = new Map();
  const panels = new Map();
  const built = new Set();
  const ids = tabs.map((t) => t.id);
  let active = null;

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tabs__tab";
    btn.id = `tab-${tab.id}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("aria-controls", `panel-${tab.id}`);
    btn.tabIndex = -1;
    btn.textContent = tab.label;
    btn.addEventListener("click", () => activate(tab.id, { focus: false }));
    buttons.set(tab.id, btn);
    tablist.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "tabs__panel";
    panel.id = `panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${tab.id}`);
    panel.tabIndex = 0;
    panel.hidden = true;
    panels.set(tab.id, panel);
    panelsWrap.appendChild(panel);
  }

  tablist.addEventListener("keydown", (event) => {
    const currentIndex = ids.indexOf(active);
    let nextIndex = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % ids.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = ids.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      activate(ids[nextIndex], { focus: true });
    }
  });

  function activate(id, { focus = false } = {}) {
    if (!buttons.has(id)) return;
    active = id;
    for (const [tabId, btn] of buttons) {
      const selected = tabId === id;
      btn.setAttribute("aria-selected", String(selected));
      btn.tabIndex = selected ? 0 : -1;
      panels.get(tabId).hidden = !selected;
    }
    if (focus) buttons.get(id).focus();
    if (!built.has(id)) {
      built.add(id);
      buildPanel?.(id, panels.get(id));
    }
    onChange?.(id);
  }

  activate(initialId && ids.includes(initialId) ? initialId : ids[0]);

  return { tablist, panelsWrap, activate };
}
