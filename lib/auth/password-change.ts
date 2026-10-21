export function validatePasswordChange(currentPassword: string, newPassword: string, confirmation: string) {
  if (!currentPassword) return 'Enter your current password.';
  if (newPassword.length < 8) return 'Your new password must contain at least eight characters.';
  if (newPassword !== confirmation) return 'The new passwords do not match.';
  if (newPassword === currentPassword) return 'Choose a new password that is different from your current password.';
  return null;
}
