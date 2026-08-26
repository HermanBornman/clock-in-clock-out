import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(80),
  storeId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
});

const updateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset_pin'), staffId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/) }),
  z.object({ action: z.literal('change_store'), staffId: z.string().uuid(), storeId: z.string().uuid() }),
]);

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
  return { admin, organizationId: String(membership.organization_id) };
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid name, role, store and four-digit PIN.' }, { status: 400 });
  const { admin, organizationId } = auth;
  const { name, role, storeId, pin } = parsed.data;

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
  return Response.json({ id: staff.id, message: `${name} was added to the team.` }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid staff update.' }, { status: 400 });
  const { admin, organizationId } = auth;
  const { staffId } = parsed.data;

  const { data: staff } = await admin.from('staff').select('id, name, store_id').eq('id', staffId).eq('organization_id', organizationId).is('archived_at', null).maybeSingle();
  if (!staff) return Response.json({ error: 'Staff member not found.' }, { status: 404 });

  if (parsed.data.action === 'reset_pin') {
    const { error } = await admin.rpc('service_set_staff_pin', { p_staff_id: staffId, p_pin: parsed.data.pin });
    if (error) return Response.json({ error: 'The PIN could not be reset. Apply the latest database migration and try again.' }, { status: 500 });
    return Response.json({ message: `${staff.name}'s PIN was reset.` });
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
