// Shay's Skills Leash. Every card, toggle, and the kill switch read real
// values from /api/automations (server/kernel/skills.js) -- none of the six
// named skills are fabricated here the way the cockpit mockup's hand-written
// stats are. See that kernel file's header for the full honesty accounting.
import { render as renderShell } from "/kit/shell.js";
import { createRegion } from "/kit/region.js";
import { panel } from "/kit/panel.js";
import { pill } from "/kit/pill.js";
import { toggle } from "/kit/toggle.js";

const root = renderShell({ pageId: "automations" });

const section = document.createElement("section");
const heading = document.createElement("h2");
heading.textContent = "Shay's Skills Leash";
const sub = document.createElement("p");
sub.className = "card__meta";
sub.textContent = "Everything Shay can do in the background -- each one has a leash. Reported honestly: most of these are not implemented yet, and every disabled toggle says why.";
section.append(heading, sub);
root.appendChild(section);

const killSwitchEl = document.createElement("div");
section.appendChild(
  panel({ title: "Emergency kill switch", route: "/api/automations", children: killSwitchEl }),
);

function renderKillSwitch(killSwitch) {
  const wrap = document.createElement("div");
  wrap.className = "skills-kill-switch";
  const state = killSwitch?.state || "unknown";
  wrap.appendChild(pill(`state: ${state}`, state === "engaged" ? "error" : state === "clear" ? "ok" : "unknown"));
  const reason = document.createElement("p");
  reason.className = "card__meta";
  reason.textContent = killSwitch?.reason || "No reason recorded.";
  wrap.appendChild(reason);

  const freezeBtn = document.createElement("button");
  freezeBtn.type = "button";
  freezeBtn.className = "btn btn--danger";
  freezeBtn.textContent = "Freeze all skills";
  freezeBtn.disabled = true;
  freezeBtn.title = "not implemented: no kill-switch source has been wired up yet, so there is nothing real for this button to engage";
  wrap.appendChild(freezeBtn);
  return wrap;
}

const gridEl = document.createElement("div");
section.appendChild(gridEl);

function skillCard(skill) {
  const card = document.createElement("article");
  card.className = "card skill-card";

  const top = document.createElement("div");
  top.className = "skill-card__top";
  const name = document.createElement("span");
  name.className = "skill-card__name";
  name.textContent = skill.name;
  top.appendChild(name);
  top.appendChild(
    toggle({
      checked: false,
      disabled: skill.toggle.disabled,
      disabledReason: skill.toggle.disabled_reason,
      label: `Toggle ${skill.name}`,
    }),
  );
  card.appendChild(top);

  const statusPill = pill(skill.implemented ? "real" : "not implemented", skill.implemented ? "ok" : "unknown");
  card.appendChild(statusPill);

  const desc = document.createElement("p");
  desc.className = "skill-card__desc";
  desc.textContent = skill.description;
  card.appendChild(desc);

  if (skill.implemented && skill.detail) {
    const detail = document.createElement("p");
    detail.className = "card__meta";
    detail.textContent = skill.detail;
    card.appendChild(detail);
  }

  const foot = document.createElement("p");
  foot.className = "card__meta skill-card__foot";
  const footParts = [];
  footParts.push(skill.schedule ? skill.schedule : skill.implemented ? "on-demand, not scheduled" : "no schedule");
  footParts.push(skill.last_run ? `last run ${skill.last_run}` : "never run");
  foot.textContent = footParts.join(" · ");
  card.appendChild(foot);

  if (skill.log_href) {
    const logLink = document.createElement("a");
    logLink.href = skill.log_href;
    logLink.textContent = "View execution log";
    logLink.className = "skill-card__log-link";
    card.appendChild(logLink);
  } else {
    const noLog = document.createElement("p");
    noLog.className = "card__meta";
    noLog.textContent = "No execution log recorded.";
    card.appendChild(noLog);
  }

  if (skill.blocked_reason) {
    const blocked = document.createElement("p");
    blocked.className = "skill-card__blocked";
    blocked.textContent = skill.blocked_reason;
    card.appendChild(blocked);
  }

  return card;
}

createRegion(gridEl, {
  collection: "skills",
  endpoint: "/api/automations",
  render(data) {
    killSwitchEl.replaceChildren(renderKillSwitch(data.kill_switch));

    const wrap = document.createElement("div");
    const count = document.createElement("p");
    count.className = "card__meta";
    const implementedCount = (data.skills || []).filter((s) => s.implemented).length;
    count.textContent = `${(data.skills || []).length} skill(s), ${implementedCount} real (source: ${data.source || "unknown"})`;
    wrap.appendChild(count);

    const grid = document.createElement("div");
    grid.className = "skill-grid";
    for (const skill of data.skills || []) grid.appendChild(skillCard(skill));
    wrap.appendChild(grid);
    return wrap;
  },
});
