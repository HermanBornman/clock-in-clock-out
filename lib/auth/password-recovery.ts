export function buildRecoveryOtpParams(email: string, token: string) {
  return {
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'recovery' as const,
  };
}

export function recoveryRequestAllowed(lastRequestedAt: string | null | undefined, now = Date.now()) {
  if (!lastRequestedAt) return true;
  const previous = Date.parse(lastRequestedAt);
  return !Number.isFinite(previous) || now - previous >= 60_000;
}
