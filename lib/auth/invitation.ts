export function buildActivationOtpParams(email: string, token: string) {
  return {
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email' as const,
  };
}
