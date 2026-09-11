const SA_ID_PATTERN = /^\d{13}$/;

export type StaffPrivateDetailsInput = {
  email: string | null;
  contactNumber: string | null;
  idNumber: string | null;
  taxNumber: string | null;
  startDate: string | null;
};

export function cleanDigits(value: string | null | undefined) {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits || null;
}

export function isValidSouthAfricanIdNumber(value: string) {
  if (!SA_ID_PATTERN.test(value)) return false;
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const testDate = new Date(Date.UTC(2000, month - 1, day));
  if (testDate.getUTCMonth() !== month - 1 || testDate.getUTCDate() !== day) return false;

  const oddPositionSum = [0, 2, 4, 6, 8, 10].reduce((sum, index) => sum + Number(value[index]), 0);
  const doubledEvenPositions = String(Number([1, 3, 5, 7, 9, 11].map((index) => value[index]).join('')) * 2);
  const doubledDigitSum = [...doubledEvenPositions].reduce((sum, digit) => sum + Number(digit), 0);
  const checkDigit = (10 - ((oddPositionSum + doubledDigitSum) % 10)) % 10;
  return checkDigit === Number(value[12]);
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function deriveBirthDateFromSouthAfricanId(idNumber: string, reference = new Date()) {
  if (!isValidSouthAfricanIdNumber(idNumber)) return null;
  const year = Number(idNumber.slice(0, 2));
  const month = Number(idNumber.slice(2, 4));
  const day = Number(idNumber.slice(4, 6));
  const candidates = [1900 + year, 2000 + year]
    .map((candidateYear) => isoDate(candidateYear, month, day))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const age = (reference.getTime() - new Date(`${value}T00:00:00Z`).getTime()) / 31_556_952_000;
      return age >= 15 && age <= 100;
    });
  return candidates.sort().at(-1) ?? null;
}

export function maskIdentifier(value: string | null | undefined) {
  if (!value) return null;
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export function normalizeStaffPrivateDetails(input: StaffPrivateDetailsInput) {
  const idNumber = cleanDigits(input.idNumber);
  const taxNumber = cleanDigits(input.taxNumber);
  return {
    email: input.email?.trim().toLowerCase() || null,
    contactNumber: input.contactNumber?.trim() || null,
    idNumber,
    taxNumber,
    startDate: input.startDate || null,
    dateOfBirth: idNumber ? deriveBirthDateFromSouthAfricanId(idNumber) : null,
  };
}
