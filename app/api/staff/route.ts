import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { deriveBirthDateFromSouthAfricanId, isValidSouthAfricanIdNumber, maskIdentifier, normalizeStaffPrivateDetails } from '@/lib/staff/details';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(80),
  storeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
  email: z.string().trim().max(200).optional().default(''),
  contactNumber: z.string().trim().max(24).optional().default(''),
  idNumber: z.string().trim().max(30).optional().default(''),
  taxNumber: z.string().trim().max(20).optional().default(''),
  startDate: z.string().trim().max(10).optional().default(''),
});

const detailFields = {
  email: z.string().trim().max(200),
  contactNumber: z.string().trim().max(24),
  idNumber: z.string().trim().max(30),
  taxNumber: z.string().trim().max(20),
  startDate: z.string().trim().max(10),
};

const updateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset_pin'), staffId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/) }),
  z.object({ action: z.literal('change_store'), staffId: z.string().uuid(), storeId: z.string().uuid() }),
  z.object({ action: z.literal('update_details'), staffId: z.string().uuid(), ...detailFields }),
]);

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getTime() <= Date.now();
}

function validatedDetails(input: { email: string; contactNumber: string; idNumber: string; taxNumber: string; startDate: string }) {
  const details = normalizeStaffPrivateDetails(input);
  if (details.email && !z.string().email().safeParse(details.email).success) return { error: 'Enter a valid staff email address.' } as const;
  if (details.contactNumber && !/^\+?[0-9][0-9\s()-]{7,23}$/.test(details.contactNumber)) return { error: 'Enter a valid contact number.' } as const;
  if (details.idNumber && !isValidSouthAfricanIdNumber(details.idNumber)) return { error: 'The South African ID number is invalid. Check all 13 digits.' } as const;
  if (details.taxNumber && !/^\d{10}$/.test(details.taxNumber)) return { error: 'The tax number must contain 10 digits.' } as const;
  if (details.startDate && !isValidIsoDate(details.startDate)) return { error: 'Enter a valid start date that is not in the future.' } as const;
  return { details } as const;
}

async function authorize(request: Request) {
  const admin = createAdminClient();
  if (!admin) return { error: Response.json({ error: 'Staff management is not configured.' }, { status: 503 }) };
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return { error: Response.json({ error: 'Authentication required.' }, { status: 401 }) };

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return { error: Response.json({ error: 'Your session has expired.' }, { status: 401 }) };
  const { data: membership } = await admin.from('memberships')
    .select('organization_id')
    .eq('user_id', userData.user.id)
    .eq('role', 'admin')
    .eq('active', true)
    .maybeSingle();
  if (!membership) return { error: Response.json({ error: 'Administrator access required.' }, { status: 403 }) };
  return { admin, organizationId: String(membership.organization_id), userId: userData.user.id };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const { admin, organizationId } = auth;
  const staffId = new URL(request.url).searchParams.get('staffId');
  let query = admin.from('staff_private_details').select('staff_id, email, contact_number, sa_id_number, tax_number, start_date, date_of_birth, updated_at').eq('organization_id', organizationId);
  if (staffId) {
    if (!z.string().uuid().safeParse(staffId).success) return Response.json({ error: 'Invalid staff member.' }, { status: 400 });
    query = query.eq('staff_id', staffId);
  }
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const details = (data ?? []).map((row) => ({
    staffId: row.staff_id,
    email: row.email,
    contactNumber: row.contact_number,
    idNumber: staffId ? row.sa_id_number : undefined,
    maskedIdNumber: maskIdentifier(row.sa_id_number),
    taxNumber: staffId ? row.tax_number : undefined,
    maskedTaxNumber: maskIdentifier(row.tax_number),
    startDate: row.start_date,
    dateOfBirth: row.date_of_birth,
    updatedAt: row.updated_at,
  }));
  return Response.json(staffId ? { details: details[0] ?? null } : { details });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid name, role, store and four-digit PIN.' }, { status: 400 });
  const { admin, organizationId, userId } = auth;
  const { name, role, storeId, pin } = parsed.data;
  const checkedDetails = validatedDetails(parsed.data);
  if ('error' in checkedDetails) return Response.json({ error: checkedDetails.error }, { status: 400 });

  const { data: store } = await admin.from('stores').select('id').eq('id', storeId).eq('organization_id', organizationId).eq('active', true).maybeSingle();
  if (!store) return Response.json({ error: 'The selected store is not available.' }, { status: 400 });

  const { data: staff, error: createError } = await admin.from('staff').insert({
    organization_id: organizationId,
    store_id: storeId,
    name,
    role,
    pin_last_two: pin.slice(-2),
    active: true,
  }).select('id').single();
  if (createError || !staff) return Response.json({ error: createError?.message ?? 'The staff member could not be added.' }, { status: 500 });

  const { error: pinError } = await admin.rpc('service_set_staff_pin', { p_staff_id: staff.id, p_pin: pin });
  if (pinError) {
    await admin.from('staff').delete().eq('id', staff.id).eq('organization_id', organizationId);
    return Response.json({ error: 'The secure PIN could not be saved. Apply the latest database migration and try again.' }, { status: 500 });
  }
  const details = checkedDetails.details;
  if (Object.values(details).some(Boolean)) {
    const { error: detailError } = await admin.rpc('service_upsert_staff_private_details', {
      p_staff_id: staff.id, p_organization_id: organizationId, p_email: details.email,
      p_contact_number: details.contactNumber, p_sa_id_number: details.idNumber,
      p_tax_number: details.taxNumber, p_start_date: details.startDate,
      p_date_of_birth: details.dateOfBirth, p_updated_by: userId,
    });
    if (detailError) {
      await admin.from('staff').delete().eq('id', staff.id).eq('organization_id', organizationId);
      return Response.json({ error: detailError.message }, { status: 500 });
    }
  }
  return Response.json({ id: staff.id, message: `${name} was added to the team.` }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid staff update.' }, { status: 400 });
  const { admin, organizationId, userId } = auth;
  const { staffId } = parsed.data;

  const { data: staff } = await admin.from('staff').select('id, name, store_id').eq('id', staffId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
  if (!staff) return Response.json({ error: 'Staff member not found.' }, { status: 404 });

  if (parsed.data.action === 'reset_pin') {
    const { error } = await admin.rpc('service_set_staff_pin', { p_staff_id: staffId, p_pin: parsed.data.pin });
    if (error) return Response.json({ error: 'The PIN could not be reset. Apply the latest database migration and try again.' }, { status: 500 });
    return Response.json({ message: `${staff.name}'s PIN was reset.` });
  }

  if (parsed.data.action === 'update_details') {
    const checked = validatedDetails(parsed.data);
    if ('error' in checked) return Response.json({ error: checked.error }, { status: 400 });
    const details = checked.details;
    const { data, error } = await admin.rpc('service_upsert_staff_private_details', {
      p_staff_id: staffId, p_organization_id: organizationId, p_email: details.email,
      p_contact_number: details.contactNumber, p_sa_id_number: details.idNumber,
      p_tax_number: details.taxNumber, p_start_date: details.startDate,
      p_date_of_birth: details.idNumber ? deriveBirthDateFromSouthAfricanId(details.idNumber) : null,
      p_updated_by: userId,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({
      message: `${staff.name}'s details were updated. Their branch was not changed.`,
      details: {
        staffId, email: data.email, contactNumber: data.contact_number,
        maskedIdNumber: maskIdentifier(data.sa_id_number), maskedTaxNumber: maskIdentifier(data.tax_number),
        startDate: data.start_date, dateOfBirth: data.date_of_birth, updatedAt: data.updated_at,
      },
    });
  }

  const { storeId } = parsed.data;
  const { data: store } = await admin.from('stores').select('id, name').eq('id', storeId).eq('organization_id', organizationId).eq('active', true).maybeSingle();
  if (!store) return Response.json({ error: 'The selected store is not available.' }, { status: 400 });
  if (staff.store_id === storeId) return Response.json({ message: `${staff.name} already works at ${store.name}.` });
  const { data: openShift } = await admin.from('attendance').select('id').eq('staff_id', staffId).is('clock_out', null).limit(1).maybeSingle();
  if (openShift) return Response.json({ error: 'Clock this staff member out before changing their store.' }, { status: 409 });
  const { error } = await admin.from('staff').update({ store_id: storeId }).eq('id', staffId).eq('organization_id', organizationId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: `${staff.name} was moved to ${store.name}.` });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const staffId = new URL(request.url).searchParams.get('staffId') ?? '';
  if (!z.string().uuid().safeParse(staffId).success) return Response.json({ error: 'Invalid staff member.' }, { status: 400 });
  const { admin, organizationId } = auth;

  const { data: staff } = await admin.from('staff').select('id, name').eq('id', staffId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
  if (!staff) return Response.json({ error: 'Staff member not found.' }, { status: 404 });
  const { data: openShift } = await admin.from('attendance').select('id').eq('staff_id', staffId).is('clock_out', null).limit(1).maybeSingle();
  if (openShift) return Response.json({ error: 'Clock this staff member out before removing them.' }, { status: 409 });

  const { error } = await admin.from('staff').update({ active: false, archived_at: new Date().toISOString() }).eq('id', staffId).eq('organization_id', organizationId);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ message: `${staff.name} was removed. Attendance and leave history were preserved.` });
}
