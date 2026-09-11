export function normalizeSouthAfricanMobile(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (/^0[6-8]\d{8}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^27[6-8]\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}
