// Formatting helpers for timestamps and counts. Never invent a value: an
// unknown denominator renders as "not computed", never 0 (convention 7).

export function formatTimestamp(value) {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not recorded";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(value) {
  if (!value) return "not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not recorded";
  const deltaMs = Date.now() - date.getTime();
  const deltaSec = Math.round(deltaMs / 1000);
  const abs = Math.abs(deltaSec);
  if (abs < 60) return "just now";
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, secs] of units) {
    if (abs >= secs) {
      const count = Math.round(abs / secs);
      const suffix = deltaSec >= 0 ? "ago" : "from now";
      return `${count} ${name}${count === 1 ? "" : "s"} ${suffix}`;
    }
  }
  return "just now";
}

export function formatCount(value, denominator) {
  if (denominator === undefined || denominator === null) return "not computed";
  if (typeof denominator === "object" && denominator.value === undefined) return "not computed";
  const total = typeof denominator === "object" ? denominator.value : denominator;
  if (total === undefined || total === null || Number.isNaN(total)) return "not computed";
  if (value === undefined || value === null) return `${total} total`;
  return `${value} / ${total}`;
}
