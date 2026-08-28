// Small status pill. status in { ok, warn, bad, unknown, empty, info, dim, error }.
// Supports both positional pill(text, status) and object pill({ text, variant, status }).

export function pill(textOrOptions, fallbackStatus = "unknown") {
  const el = document.createElement("span");
  let text = textOrOptions;
  let status = fallbackStatus;

  if (typeof textOrOptions === "object" && textOrOptions !== null) {
    text = textOrOptions.text || "";
    status = textOrOptions.variant || textOrOptions.status || fallbackStatus;
  }

  el.className = `pill pill--${status}`;
  el.textContent = text;
  return el;
}
