// Shay's Workspace: live cybernetic execution cockpit & telemetry stream.
// Renders active build steps, real-time step progress ladder with timing,
// and timestamped terminal output streams.
import { formatTimestamp } from "./format.js";

const DEFAULT_STEPS = [
  { id: "spec", name: "Ingest page structure spec", status: "completed", duration: "1.2s" },
  { id: "copy", name: "Draft hero copy (2 variants)", status: "completed", duration: "0.8s" },
  { id: "imagery", name: "Convert hero image → WebP", status: "completed", duration: "2.1s" },
  { id: "css", name: "Compile CSS primitives", status: "running", duration: "0.4s" },
  { id: "shadow", name: "Render shadow preview", status: "pending", duration: "" },
  { id: "diff", name: "Stage diff for your review", status: "pending", duration: "" },
];

const DEFAULT_LOGS = [
  { time: "12:48:39", type: "info", text: "drafting proof B · palette: green/gold" },
  { time: "12:48:39", type: "success", text: "hero image → WebP (-1.9 MB, 2.1s)" },
  { time: "12:48:39", type: "info", text: "compiling CSS primitives for active site" },
  { time: "12:48:39", type: "warn", text: "asset church-hero.png is slowing build by 4.2s — flagged" },
  { time: "12:48:42", type: "success", text: "incremental cache hit: 14/16 pages untouched" },
  { time: "12:48:45", type: "info", text: "proof B rendered · staging for triage" },
  { time: "12:48:47", type: "cyan", text: "crawler: 0 new broken links across 16 sites" },
  { time: "12:48:50", type: "success", text: "shadow preview ready — diff staged for review" },
  { time: "12:48:52", type: "purple", text: "ingested brief #4413 (Port St. Lucie Youth Sports)" },
  { time: "12:48:55", type: "success", text: "signature verified — payload trusted" },
];

export function createShayWorkspace({ siteId = "current-site", onAction } = {}) {
  const root = document.createElement("div");
  root.className = "shay-workspace";

  // --- Header ---
  const header = document.createElement("div");
  header.className = "shay-workspace__header";

  const brand = document.createElement("div");
  brand.className = "shay-workspace__brand";
  const orb = document.createElement("div");
  orb.className = "orb orb--active";
  orb.setAttribute("aria-hidden", "true");
  const title = document.createElement("span");
  title.className = "shay-workspace__title";
  title.textContent = "SHAY'S WORKSPACE";
  brand.append(orb, title);

  const statusBadge = document.createElement("span");
  statusBadge.className = "pill pill--active-glow";
  statusBadge.textContent = "● ACTIVE";

  header.append(brand, statusBadge);

  // --- Currently Executing Card ---
  const execCard = document.createElement("div");
  execCard.className = "shay-workspace__exec";

  const execLabel = document.createElement("div");
  execLabel.className = "shay-workspace__exec-label";
  execLabel.textContent = "CURRENTLY EXECUTING";

  const execTitle = document.createElement("div");
  execTitle.className = "shay-workspace__exec-title";
  execTitle.textContent = "compress + swap hero asset";

  const execTarget = document.createElement("div");
  execTarget.className = "shay-workspace__exec-target";
  execTarget.textContent = `→ ${siteId}.com (shadow branch)`;

  execCard.append(execLabel, execTitle, execTarget);

  // --- Build Steps Ladder ---
  const stepsSection = document.createElement("div");
  stepsSection.className = "shay-workspace__steps";

  const stepsHeader = document.createElement("div");
  stepsHeader.className = "shay-workspace__section-label";
  stepsHeader.textContent = "BUILD STEPS · HOMEPAGE PROPOSAL";
  stepsSection.appendChild(stepsHeader);

  const stepList = document.createElement("ul");
  stepList.className = "shay-workspace__step-list";

  for (const step of DEFAULT_STEPS) {
    const li = document.createElement("li");
    li.className = `shay-workspace__step shay-workspace__step--${step.status}`;

    const icon = document.createElement("span");
    icon.className = "shay-workspace__step-icon";
    if (step.status === "completed") icon.innerHTML = "&#10003;";
    else if (step.status === "running") icon.innerHTML = "&#9881;";
    else icon.innerHTML = "&#9675;";

    const name = document.createElement("span");
    name.className = "shay-workspace__step-name";
    name.textContent = step.name;

    const duration = document.createElement("span");
    duration.className = "shay-workspace__step-dur";
    duration.textContent = step.duration;

    li.append(icon, name, duration);
    stepList.appendChild(li);
  }
  stepsSection.appendChild(stepList);

  // --- Live Output Stream Box ---
  const streamSection = document.createElement("div");
  streamSection.className = "shay-workspace__stream";

  const streamHeader = document.createElement("div");
  streamHeader.className = "shay-workspace__section-label";
  streamHeader.textContent = "LIVE OUTPUT STREAM";
  streamSection.appendChild(streamHeader);

  const termBox = document.createElement("div");
  termBox.className = "shay-workspace__terminal";
  termBox.setAttribute("role", "log");
  termBox.setAttribute("aria-live", "polite");

  for (const log of DEFAULT_LOGS) {
    const row = document.createElement("div");
    row.className = `shay-workspace__log-line shay-workspace__log-line--${log.type}`;

    const time = document.createElement("span");
    time.className = "shay-workspace__log-time";
    time.textContent = `[${log.time}]`;

    const txt = document.createElement("span");
    txt.className = "shay-workspace__log-text";
    txt.textContent = ` ${log.text}`;

    row.append(time, txt);
    termBox.appendChild(row);
  }
  streamSection.appendChild(termBox);

  // --- Quick Actions Bar ---
  const actions = document.createElement("div");
  actions.className = "shay-workspace__actions";

  const triggerBtn = document.createElement("button");
  triggerBtn.type = "button";
  triggerBtn.className = "btn btn--small btn--primary";
  triggerBtn.textContent = "⚡ Run Next Stage";
  triggerBtn.addEventListener("click", () => {
    if (typeof onAction === "function") onAction("run_next_stage");
    appendLog(`[${new Date().toTimeString().slice(0, 8)}] running verification stage...`, "cyan");
  });

  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.className = "btn btn--small";
  pauseBtn.textContent = "Pause Swarm";
  pauseBtn.addEventListener("click", () => {
    if (typeof onAction === "function") onAction("pause_swarm");
    appendLog(`[${new Date().toTimeString().slice(0, 8)}] swarm paused by operator.`, "warn");
  });

  actions.append(triggerBtn, pauseBtn);

  function appendLog(text, type = "info") {
    const row = document.createElement("div");
    row.className = `shay-workspace__log-line shay-workspace__log-line--${type}`;
    const timeStr = new Date().toTimeString().slice(0, 8);
    row.innerHTML = `<span class="shay-workspace__log-time">[${timeStr}]</span> <span class="shay-workspace__log-text">${text}</span>`;
    termBox.appendChild(row);
    termBox.scrollTop = termBox.scrollHeight;
  }

  root.append(header, execCard, stepsSection, streamSection, actions);

  return { root, appendLog };
}
