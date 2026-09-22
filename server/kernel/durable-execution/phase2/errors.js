export function phase2Failure(statusCode, code, message, details = undefined) {
  const error = Object.assign(new Error(message), { statusCode, code });
  if (details !== undefined) error.details = details;
  return error;
}

export function requirePhase2(condition, statusCode, code, message, details = undefined) {
  if (!condition) throw phase2Failure(statusCode, code, message, details);
}
