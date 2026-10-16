// Test di accettazione – FETTA 8d (ritratti dei barbieri). La fetta non è ancora in docs/SPEC.md:
// le regole vengono dalle decisioni approvate dall'utente ("8d dec. N") e da SPEC §3.3 (barbieri:
// "foto"), §5.2 passo 2 (scelta del barbiere con foto), CLAUDE.md – Sicurezza.
//
// Interfacce attese:
//   src/lib/barbers/photo.ts (puro)
//     BARBER_PHOTOS_BUCKET = 'barber-photos'
//     newBarberPhotoPath(barberId: string): string          '<barberId>/<32 hex minuscoli>.webp'
//     isBarberPhotoPath(barberId: string, path: string): boolean
//     barberPhotoUrl(path: string | null): string | null
//       `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/barber-photos/${path}`, null se null
//   src/lib/admin/barber-photo-actions.ts ("use server"), requireRole(['admin']) per prima cosa
//     uploadBarberPhoto(previous, formData: barberId, photo)
//       → { status: 'idle' | 'saved' | 'invalid' | 'too_large' | 'not_image' | 'error' }
//     removeBarberPhoto(previous, formData: barberId)
//       → { status: 'idle' | 'ok' | 'invalid' | 'error' }
//       Tipo dichiarato image/webp o image/jpeg (correzione 1, Safari iOS); il contenuto reale,
//       decodificato da sharp, deve essere WebP o JPEG; nel bucket finisce sempre WebP 512×512.
//   src/lib/barbers/portrait-encoding.ts (puro, senza DOM)
//     PORTRAIT_SIZE = 512
//     encodePortrait(encode: (type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob | null>)
//       → Promise<Blob | null>: prima WebP 0.85, se null o di altro tipo ripiego JPEG 0.85, altrimenti null
//   src/lib/admin/barber-actions.ts: deleteBarber cancella anche il file del ritratto.
//   src/i18n/it.ts: it.booking.barber.portraitAlt "Ritratto di {name}" e it.admin.barbers.portrait*.
//
// Database e Storage sono sostituiti da un finto in memoria (come admin-staff-accounts.test.ts):
// - `@/lib/auth/current-user`: requireRole con il ruolo scelto dal test;
// - `@/lib/db/server`: client dell'utente con `.from(...)` (barbers con il check
//   barbers_photo_path_format e l'FK delle prenotazioni) e `storage.from(bucket).upload/remove`
//   con le regole del bucket barber-photos (1 MB, solo image/webp);
// - `@/lib/db/admin`: il service_role non va usato (dec. 5: client dell'utente).
// sharp è reale: le immagini sono generate nel test e il file caricato viene decodificato.
// Non modificare durante l'implementazione (CLAUDE.md – Flusso di lavoro).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Interfacce attese
// ---------------------------------------------------------------------------
type UploadState = { status: 'idle' | 'saved' | 'invalid' | 'too_large' | 'not_image' | 'error' };
type RemoveState = { status: 'idle' | 'ok' | 'invalid' | 'error' };
type BarberRowState = { status: 'idle' | 'ok' | 'has_bookings' | 'error' };
type BarberFormState = { status: 'idle' | 'saved' | 'invalid' | 'error'; futureBookings?: number | null };

type PhotoModule = {
  BARBER_PHOTOS_BUCKET: string;
  newBarberPhotoPath: (barberId: string) => string;
  isBarberPhotoPath: (barberId: string, path: string) => boolean;
  barberPhotoUrl: (path: string | null) => string | null;
};
type PhotoActionsModule = {
  uploadBarberPhoto: (previous: UploadState, formData: FormData) => Promise<UploadState>;
  removeBarberPhoto: (previous: RemoveState, formData: FormData) => Promise<RemoveState>;
};
type BarberActionsModule = {
  deleteBarber: (previous: BarberRowState, formData: FormData) => Promise<BarberRowState>;
  saveBarber: (previous: BarberFormState, formData: FormData) => Promise<BarberFormState>;
};

const load = async <T>(specifier: string): Promise<T> =>
  (await import(/* @vite-ignore */ specifier)) as T;

type EncodingModule = {
  PORTRAIT_SIZE: number;
  encodePortrait: (
    encode: (type: 'image/webp' | 'image/jpeg', quality: number) => Promise<Blob | null>,
  ) => Promise<Blob | null>;
};

const PHOTO = '@/lib/barbers/photo';
const ENCODING = '@/lib/barbers/portrait-encoding';
const PHOTO_ACTIONS = '@/lib/admin/barber-photo-actions';
const BARBER_ACTIONS = '@/lib/admin/barber-actions';

// ---------------------------------------------------------------------------
// Database e Storage finti
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type DbResult = { data: unknown; error: DbError | null; count?: number | null };

const fake = vi.hoisted(() => ({
  currentRole: 'admin' as 'customer' | 'barber' | 'admin' | null,
  /** Eventi in ordine: requireRole, createClient, chiamate a database e storage. */
  log: [] as string[],
  updates: [] as Array<{ table: string; payload: unknown }>,
  uploads: [] as Array<{ bucket: string; path: string; contentType: string; body: Buffer }>,
  removes: [] as Array<{ bucket: string; paths: string[] }>,
  barbers: [] as Array<Record<string, unknown>>,
  barberServices: [] as Array<Record<string, unknown>>,
  bookings: [] as Array<Record<string, unknown>>,
  objects: new Map<string, { bucket: string; path: string; body: Buffer; contentType: string }>(),
  failBarbersUpdate: false,
  failUpload: false,
  failRemove: false,
  makeClient: null as unknown as (kind: 'server' | 'admin') => unknown,
}));

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
    has: () => false,
  }),
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => {
  const leave = (kind: string) => (to?: string) => {
    fake.log.push(`redirect:${to ?? kind}`);
    throw Object.assign(new Error(`NEXT_${kind}`), { digest: `NEXT_${kind};replace;${to ?? ''};307;` });
  };
  return {
    redirect: leave('REDIRECT'),
    permanentRedirect: leave('REDIRECT'),
    notFound: leave('NOT_FOUND'),
    forbidden: leave('FORBIDDEN'),
    unauthorized: leave('UNAUTHORIZED'),
  };
});

vi.mock('@/lib/auth/current-user', () => {
  const user = () =>
    fake.currentRole === null
      ? null
      : { id: 'a0000000-0000-4000-8000-000000000001', role: fake.currentRole, isBlocked: false, profileComplete: true };
  const leave = (to: string): never => {
    fake.log.push(`redirect:${to}`);
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  };
  return {
    getCurrentUser: async () => user(),
    loadCurrentUser: async () => user(),
    requireRole: async (allowed: readonly string[]) => {
      fake.log.push(`requireRole:${[...allowed].sort().join(',')}`);
      const current = user();
      if (current === null) return leave('/admin/login');
      if (!allowed.includes(current.role)) return leave(current.role === 'customer' ? '/' : '/admin');
      return current;
    },
  };
});

vi.mock('@/lib/db/server', () => ({
  createClient: async () => {
    fake.log.push('createClient:server');
    return fake.makeClient('server');
  },
}));

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => {
    fake.log.push('createAdminClient');
    return fake.makeClient('admin');
  },
}));

// --- Implementazione del finto -------------------------------------------------
const BUCKET = 'barber-photos';
const MAX_BYTES = 1048576;
const objectKey = (bucket: string, path: string): string => `${bucket}::${path}`;

/** Check barbers_photo_path_format (dec. 2), come nel database. */
const validPhotoPath = (id: string, path: unknown): boolean =>
  path === null || (typeof path === 'string' && new RegExp(`^${id}/[0-9a-f]{32}\\.webp$`).test(path));

const tableRows = (name: string): Row[] => {
  if (name === 'barbers') return fake.barbers as Row[];
  if (name === 'barber_services') return fake.barberServices as Row[];
  if (name === 'bookings') return fake.bookings as Row[];
  return [];
};

type Filter = (row: Row) => boolean;

/** Query builder minimo, "thenable" come quello di supabase-js. */
const queryBuilder = (client: 'server' | 'admin', table: string): unknown => {
  const filters: Filter[] = [];
  let action: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  let payload: unknown;
  let selected: string | null = null;
  let selectCalled = false;
  let head = false;

  const run = (): DbResult => {
    fake.log.push(`${client}:from:${table}:${action}`);
    if (action === 'update') fake.updates.push({ table, payload });
    // Grant di colonna su barbers (ADR 001): niente "*" né profile_id
    if (table === 'barbers' && selectCalled) {
      const columns = (selected ?? '').replace(/\s/g, '');
      if (columns === '' || columns.includes('*') || /\bprofile_id\b/.test(columns)) {
        return { data: null, error: { code: '42501', message: 'permission denied for table barbers' } };
      }
    }
    const rows = tableRows(table);
    const matching = rows.filter((row) => filters.every((filter) => filter(row)));

    if (action === 'select') {
      return { data: head ? null : matching.map((row) => ({ ...row })), error: null, count: matching.length };
    }

    if (action === 'update') {
      if (table === 'barbers' && fake.failBarbersUpdate) {
        return { data: null, error: { code: '08006', message: 'connection failure' } };
      }
      const values = payload as Row;
      if (table === 'barbers' && 'photo_path' in values) {
        if (matching.some((row) => !validPhotoPath(String(row.id), values.photo_path))) {
          return {
            data: null,
            error: { code: '23514', message: 'new row for relation "barbers" violates check constraint "barbers_photo_path_format"' },
          };
        }
      }
      for (const row of matching) Object.assign(row, values);
      return { data: matching.map((row) => ({ ...row })), error: null, count: matching.length };
    }

    if (action === 'delete') {
      if (table === 'barbers') {
        const referenced = matching.some((row) => fake.bookings.some((booking) => booking.barber_id === row.id));
        if (referenced) {
          return {
            data: null,
            error: { code: '23503', message: 'update or delete on table "barbers" violates foreign key constraint' },
          };
        }
      }
      for (const row of matching) rows.splice(rows.indexOf(row), 1);
      return { data: matching.map((row) => ({ ...row })), error: null, count: matching.length };
    }

    const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
    rows.push(...incoming.map((row) => ({ ...row })));
    return { data: incoming.map((row) => ({ ...row })), error: null, count: incoming.length };
  };

  const builder: Record<string, unknown> = {};
  const chain = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
    fn(...args);
    return builder;
  };
  Object.assign(builder, {
    select: chain((columns?: unknown, options?: unknown) => {
      selectCalled = true;
      selected = typeof columns === 'string' ? columns : '';
      if ((options as { head?: boolean } | undefined)?.head) head = true;
    }),
    insert: chain((values: unknown) => {
      action = 'insert';
      payload = values;
    }),
    upsert: chain((values: unknown) => {
      action = 'upsert';
      payload = values;
    }),
    update: chain((values: unknown) => {
      action = 'update';
      payload = values;
    }),
    delete: chain(() => {
      action = 'delete';
    }),
    eq: chain((column: unknown, value: unknown) => filters.push((row) => row[String(column)] === value)),
    neq: chain((column: unknown, value: unknown) => filters.push((row) => row[String(column)] !== value)),
    gt: chain((column: unknown, value: unknown) => filters.push((row) => String(row[String(column)]) > String(value))),
    is: chain((column: unknown, value: unknown) => filters.push((row) => (row[String(column)] ?? null) === value)),
    in: chain((column: unknown, values: unknown) =>
      filters.push((row) => (values as unknown[]).includes(row[String(column)])),
    ),
    match: chain((query: unknown) =>
      filters.push((row) => Object.entries(query as Row).every(([key, value]) => row[key] === value)),
    ),
    order: chain(() => undefined),
    limit: chain(() => undefined),
    returns: chain(() => undefined),
    abortSignal: chain(() => undefined),
    single: async () => {
      const result = run();
      if (result.error) return result;
      const list = result.data as Row[];
      return list.length === 1
        ? { data: list[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    },
    maybeSingle: async () => {
      const result = run();
      if (result.error) return result;
      const list = result.data as Row[];
      return { data: list[0] ?? null, error: null };
    },
    then: (onFulfilled: (value: DbResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve().then(run).then(onFulfilled, onRejected),
  });
  return builder;
};

const toBuffer = async (body: unknown): Promise<Buffer | null> => {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  return null;
};

/** storage.from(bucket): regole del bucket barber-photos (dec. 3). */
const storageBucket = (client: 'server' | 'admin', bucket: string) => ({
  upload: async (path: string, body: unknown, options?: { contentType?: string; upsert?: boolean }) => {
    fake.log.push(`${client}:storage:upload`);
    const buffer = await toBuffer(body);
    // Senza contentType esplicito supabase-js invia text/plain (tranne che per i Blob)
    const contentType = options?.contentType ?? (body instanceof Blob ? body.type : 'text/plain;charset=UTF-8');
    fake.uploads.push({ bucket, path, contentType, body: buffer ?? Buffer.alloc(0) });
    const fail = (statusCode: string, message: string) => ({ data: null, error: { name: 'StorageApiError', statusCode, message } });
    if (fake.failUpload) return fail('500', 'internal error');
    if (bucket !== BUCKET) return fail('404', 'Bucket not found');
    if (buffer === null) return fail('400', 'unsupported body');
    if (buffer.length > MAX_BYTES) return fail('413', 'The object exceeded the maximum allowed size');
    if (contentType !== 'image/webp') return fail('415', `mime type ${contentType} is not supported`);
    if (fake.objects.has(objectKey(bucket, path)) && !options?.upsert) return fail('409', 'The resource already exists');
    fake.objects.set(objectKey(bucket, path), { bucket, path, body: buffer, contentType });
    return { data: { id: `obj-${fake.uploads.length}`, path, fullPath: `${bucket}/${path}` }, error: null };
  },
  remove: async (paths: string[]) => {
    fake.log.push(`${client}:storage:remove`);
    fake.removes.push({ bucket, paths: [...paths] });
    if (fake.failRemove) return { data: null, error: { name: 'StorageApiError', statusCode: '500', message: 'internal error' } };
    const removed = paths.filter((path) => fake.objects.delete(objectKey(bucket, path)));
    return { data: removed.map((name) => ({ name })), error: null };
  },
  getPublicUrl: (path: string) => ({
    data: { publicUrl: `http://127.0.0.1:54321/storage/v1/object/public/${bucket}/${path}` },
  }),
});

fake.makeClient = (kind: 'server' | 'admin') => ({
  from: (table: string) => queryBuilder(kind, table),
  rpc: async (name: string) => {
    fake.log.push(`${kind}:rpc:${name}`);
    return { data: null, error: { code: 'PGRST202', message: `function public.${name} not found` } };
  },
  storage: { from: (bucket: string) => storageBucket(kind, bucket) },
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => {
      throw new Error('getSession() non va usato lato server');
    },
  },
});

// ---------------------------------------------------------------------------
// Dati di partenza
// ---------------------------------------------------------------------------
const MARIO = 'b0000000-0000-4000-8000-000000000001';
const LUCA = 'b0000000-0000-4000-8000-000000000002';
const SARA = 'b0000000-0000-4000-8000-000000000003';
const MISSING = 'b0000000-0000-4000-8000-000000000999';
const SERVICE = '50000000-0000-4000-8000-000000000001';
const LUCA_OLD = `${LUCA}/0123456789abcdef0123456789abcdef.webp`;
const SARA_OLD = `${SARA}/fedcba9876543210fedcba9876543210.webp`;
const PATH_FORMAT = (id: string): RegExp => new RegExp(`^${id}/[0-9a-f]{32}\\.webp$`);

const reset = (): void => {
  fake.currentRole = 'admin';
  fake.log = [];
  fake.updates = [];
  fake.uploads = [];
  fake.removes = [];
  fake.failBarbersUpdate = false;
  fake.failUpload = false;
  fake.failRemove = false;
  fake.barbers = [
    { id: MARIO, display_name: 'Mario', photo_path: null, bio: null, is_active: true, profile_id: null },
    { id: LUCA, display_name: 'Luca', photo_path: LUCA_OLD, bio: null, is_active: true, profile_id: null },
    { id: SARA, display_name: 'Sara', photo_path: SARA_OLD, bio: null, is_active: true, profile_id: null },
  ];
  fake.barberServices = [{ barber_id: LUCA, service_id: SERVICE }];
  fake.bookings = [];
  fake.objects = new Map();
  for (const path of [LUCA_OLD, SARA_OLD]) {
    fake.objects.set(objectKey(BUCKET, path), { bucket: BUCKET, path, body: Buffer.from('vecchio'), contentType: 'image/webp' });
  }
};

const barber = (id: string): Row | undefined => fake.barbers.find((row) => row.id === id) as Row | undefined;
const storedPaths = (): string[] => [...fake.objects.values()].map((object) => object.path).sort();
const snapshot = (): string =>
  JSON.stringify({ barbers: fake.barbers, objects: storedPaths() });
const barberUpdates = () => fake.updates.filter((update) => update.table === 'barbers');
const usedServiceRole = (): boolean =>
  fake.log.some((event) => event === 'createAdminClient' || event.startsWith('admin:'));
const touchedStorageOrDb = (): string[] =>
  fake.log.filter((event) => /^(?:server|admin):(?:from|rpc|storage)/.test(event));

/** requireRole(['admin']) chiamato prima di qualunque accesso a database o storage. */
const expectAdminCheckFirst = (): void => {
  const roleAt = fake.log.indexOf('requireRole:admin');
  expect(roleAt, `requireRole(['admin']) non chiamato; eventi: ${fake.log.join(' → ')}`).toBeGreaterThanOrEqual(0);
  const firstAccess = fake.log.findIndex((event) => /^(?:server|admin):|^createClient|^createAdminClient/.test(event));
  if (firstAccess >= 0) expect(roleAt).toBeLessThan(firstAccess);
};

const IDLE = { status: 'idle' } as const;

// --- Immagini generate con sharp ------------------------------------------------
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } } });

const webpOf = (width: number, height: number): Promise<Buffer> => solid(width, height).webp().toBuffer();

/** 1500×500 in tre fasce verticali: rossa, verde (al centro), blu. */
const stripesWebp = async (): Promise<Buffer> => {
  const width = 1500;
  const height = 500;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      raw[offset] = x < 500 ? 255 : 0;
      raw[offset + 1] = x >= 500 && x < 1000 ? 255 : 0;
      raw[offset + 2] = x >= 1000 ? 255 : 0;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).webp({ quality: 95 }).toBuffer();
};

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#000"/></svg>',
);

const photoForm = (photo: File | string | null, extra: Record<string, string> = {}, barberId: string | null = LUCA): FormData => {
  const data = new FormData();
  if (barberId !== null) data.append('barberId', barberId);
  if (photo !== null) data.append('photo', photo);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  return data;
};

const file = (body: Buffer, type: string, name = 'ritratto.webp'): File => new File([new Uint8Array(body)], name, { type });

const photoActions = async (): Promise<PhotoActionsModule> => {
  const mod = await load<PhotoActionsModule>(PHOTO_ACTIONS);
  expect(mod.uploadBarberPhoto, 'barber-photo-actions.ts deve esportare uploadBarberPhoto').toBeTypeOf('function');
  expect(mod.removeBarberPhoto, 'barber-photo-actions.ts deve esportare removeBarberPhoto').toBeTypeOf('function');
  return mod;
};

beforeEach(() => {
  reset();
  vi.resetModules();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Helper puri – src/lib/barbers/photo.ts (dec. 2 e 6)
// ---------------------------------------------------------------------------
describe('photo.ts – percorsi e URL dei ritratti (8d dec. 2, 6)', () => {
  const photo = async (): Promise<PhotoModule> => load<PhotoModule>(PHOTO);

  test('il bucket si chiama barber-photos', async () => {
    expect((await photo()).BARBER_PHOTOS_BUCKET).toBe('barber-photos');
  });

  test('newBarberPhotoPath genera <barberId>/<32 hex minuscoli>.webp, ogni volta diverso', async () => {
    const { newBarberPhotoPath, isBarberPhotoPath } = await photo();
    const paths = Array.from({ length: 20 }, () => newBarberPhotoPath(LUCA));
    for (const path of paths) {
      expect(path).toMatch(PATH_FORMAT(LUCA));
      expect(isBarberPhotoPath(LUCA, path)).toBe(true);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  test('isBarberPhotoPath accetta solo il formato del barbiere indicato', async () => {
    const { isBarberPhotoPath } = await photo();
    const hex = '0123456789abcdef0123456789abcdef';
    expect(isBarberPhotoPath(LUCA, `${LUCA}/${hex}.webp`)).toBe(true);
    for (const path of [
      `${SARA}/${hex}.webp`,
      `${LUCA.toUpperCase()}/${hex}.webp`,
      `${LUCA}/../${SARA}/${hex}.webp`,
      `${LUCA}/${hex}.png`,
      `${LUCA}/${hex}.WEBP`,
      `${LUCA}/${hex.toUpperCase()}.webp`,
      `${LUCA}/${hex.slice(1)}.webp`,
      `${LUCA}/${hex}0.webp`,
      `/${LUCA}/${hex}.webp`,
      `${LUCA}/x/${hex}.webp`,
      `${LUCA}/${hex}.webp\n`,
      `barber-photos/${LUCA}/${hex}.webp`,
      'foto.webp',
      '',
    ]) {
      expect(isBarberPhotoPath(LUCA, path), JSON.stringify(path)).toBe(false);
    }
  });

  test('barberPhotoUrl: URL pubblico del bucket, null senza ritratto', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    const { barberPhotoUrl } = await photo();
    expect(barberPhotoUrl(null)).toBeNull();
    expect(barberPhotoUrl(LUCA_OLD)).toBe(`http://127.0.0.1:54321/storage/v1/object/public/barber-photos/${LUCA_OLD}`);
  });
});

// ---------------------------------------------------------------------------
// Codifica nel browser – src/lib/barbers/portrait-encoding.ts (correzione 1, Safari iOS)
// ---------------------------------------------------------------------------
describe('encodePortrait – WebP con ripiego JPEG (correzione 1)', () => {
  const encoding = async (): Promise<EncodingModule> => load<EncodingModule>(ENCODING);
  const blob = (type: string): Blob => new Blob([new Uint8Array([1, 2, 3])], { type });

  /** Encoder finto: restituisce, per ogni tipo richiesto, il risultato indicato. */
  const encoder = (results: Partial<Record<'image/webp' | 'image/jpeg', Blob | null>>) => {
    const calls: Array<[string, number]> = [];
    const encode = async (type: 'image/webp' | 'image/jpeg', quality: number): Promise<Blob | null> => {
      calls.push([type, quality]);
      return results[type] ?? null;
    };
    return { calls, encode };
  };

  test('PORTRAIT_SIZE è 512', async () => {
    expect((await encoding()).PORTRAIT_SIZE).toBe(512);
  });

  test('WebP riuscita → un solo encode (image/webp, 0.85) e blob WebP', async () => {
    const { encodePortrait } = await encoding();
    const webp = blob('image/webp');
    const { calls, encode } = encoder({ 'image/webp': webp, 'image/jpeg': blob('image/jpeg') });
    expect(await encodePortrait(encode)).toBe(webp);
    expect(calls).toEqual([['image/webp', 0.85]]);
  });

  test.each([
    ['restituisce PNG (Safari iOS)', blob('image/png')],
    ['restituisce null', null],
  ])('WebP che %s → ripiego JPEG con quality 0.85', async (_label, webpResult) => {
    const { encodePortrait } = await encoding();
    const jpeg = blob('image/jpeg');
    const { calls, encode } = encoder({ 'image/webp': webpResult, 'image/jpeg': jpeg });
    expect(await encodePortrait(encode)).toBe(jpeg);
    expect(calls).toEqual([['image/webp', 0.85], ['image/jpeg', 0.85]]);
  });

  test.each([
    ['null', null],
    ['di tipo PNG', blob('image/png')],
  ])('anche il JPEG fallisce (%s) → null', async (_label, jpegResult) => {
    const { encodePortrait } = await encoding();
    const { encode } = encoder({ 'image/webp': blob('image/png'), 'image/jpeg': jpegResult });
    expect(await encodePortrait(encode)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// uploadBarberPhoto (dec. 5)
// ---------------------------------------------------------------------------
describe('uploadBarberPhoto – caricamento e sostituzione del ritratto (8d dec. 2, 3, 5)', () => {
  test('carica una WebP quadrata: 512×512 WebP al percorso generato, photo_path aggiornato', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(800, 800), 'image/webp'), {}, MARIO));

    expect(result.status).toBe('saved');
    expectAdminCheckFirst();
    expect(usedServiceRole(), 'dec. 5: si usa il client dell\'utente, non il service_role').toBe(false);
    expect(fake.uploads).toHaveLength(1);
    const [upload] = fake.uploads;
    expect(upload?.bucket).toBe('barber-photos');
    expect(upload?.path).toMatch(PATH_FORMAT(MARIO));
    expect(upload?.contentType).toBe('image/webp');
    const meta = await sharp(upload?.body).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: 512, height: 512 });
    expect(barber(MARIO)?.photo_path).toBe(upload?.path);
    expect(fake.removes, 'nessun ritratto precedente da cancellare').toEqual([]);
  });

  // Correzione 1 (Safari iOS: canvas.toBlob('image/webp') dà PNG): il browser ripiega su JPEG.
  // Conta il contenuto reale decodificato da sharp, purché WebP o JPEG; nel bucket sempre WebP.
  test.each([
    ['JPEG dichiarata image/jpeg', 'image/jpeg'],
    ['JPEG dichiarata image/webp', 'image/webp'],
  ])('%s → saved, caricata come WebP 512×512', async (_label, type) => {
    const { uploadBarberPhoto } = await photoActions();
    const jpeg = await solid(900, 700).jpeg().toBuffer();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(jpeg, type, 'ritratto.jpg'), {}, MARIO));

    expect(result.status).toBe('saved');
    expect(fake.uploads).toHaveLength(1);
    const [upload] = fake.uploads;
    expect(upload?.path).toMatch(PATH_FORMAT(MARIO));
    expect(upload?.contentType).toBe('image/webp');
    const meta = await sharp(upload?.body).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'webp', width: 512, height: 512 });
    expect(barber(MARIO)?.photo_path).toBe(upload?.path);
  });

  test('WebP dichiarata image/jpeg → saved (conta il contenuto reale)', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/jpeg'), {}, MARIO));
    expect(result.status).toBe('saved');
    expect(fake.uploads[0]?.contentType).toBe('image/webp');
  });

  // dec. 5: ritaglio al centro se non quadrato
  test('un\'immagine non quadrata viene ritagliata al centro', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await stripesWebp(), 'image/webp'), {}, MARIO));

    expect(result.status).toBe('saved');
    const body = fake.uploads[0]?.body;
    const { data, info } = await sharp(body).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect({ width: info.width, height: info.height }).toEqual({ width: 512, height: 512 });
    // Angoli e centro devono venire dalla fascia verde centrale
    for (const [x, y] of [[8, 8], [503, 8], [8, 503], [503, 503], [256, 256]] as const) {
      const offset = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
      expect({ x, y, green: g > 180 && r < 80 && b < 80 }, `pixel (${x}, ${y}) = ${r},${g},${b}`).toEqual({ x, y, green: true });
    }
  });

  // dec. 5: sostituzione → upload, update, poi rimozione del file precedente
  test('sostituisce il ritratto: nuovo percorso, file precedente cancellato dopo l\'update', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp')));

    expect(result.status).toBe('saved');
    const newPath = String(barber(LUCA)?.photo_path);
    expect(newPath).toMatch(PATH_FORMAT(LUCA));
    expect(newPath).not.toBe(LUCA_OLD);
    expect(storedPaths()).toEqual([newPath, SARA_OLD].sort());
    expect(fake.removes).toEqual([{ bucket: 'barber-photos', paths: [LUCA_OLD] }]);

    const uploadAt = fake.log.indexOf('server:storage:upload');
    const updateAt = fake.log.indexOf('server:from:barbers:update');
    const removeAt = fake.log.indexOf('server:storage:remove');
    expect(uploadAt, 'upload prima dell\'update').toBeLessThan(updateAt);
    expect(updateAt, 'il file vecchio si cancella solo dopo l\'update').toBeLessThan(removeAt);
  });

  // dec. 2 e 5: il percorso lo genera sempre il server
  test('campi extra del form (path, photoPath) vengono ignorati', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(
      IDLE,
      photoForm(file(await webpOf(600, 600), 'image/webp'), {
        path: `../${SARA_OLD}`,
        photoPath: SARA_OLD,
        photo_path: SARA_OLD,
        name: `${LUCA}/ffffffffffffffffffffffffffffffff.webp`,
      }),
    );

    expect(result.status).toBe('saved');
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.path).toMatch(PATH_FORMAT(LUCA));
    expect(fake.uploads[0]?.path).not.toBe(`${LUCA}/ffffffffffffffffffffffffffffffff.webp`);
    expect(barber(LUCA)?.photo_path).toBe(fake.uploads[0]?.path);
    expect(barber(SARA)?.photo_path).toBe(SARA_OLD);
    expect(storedPaths()).toContain(SARA_OLD);
    expect(fake.removes.flatMap((remove) => remove.paths)).toEqual([LUCA_OLD]);
  });

  // dec. 5 + correzione 1: Zod – barberId uuid, photo File non vuoto con type image/webp o image/jpeg
  test.each([
    ['PNG dichiarata image/png', async () => file(await solid(600, 600).png().toBuffer(), 'image/png', 'ritratto.png')],
    ['SVG dichiarata image/svg+xml', async () => file(SVG, 'image/svg+xml', 'ritratto.svg')],
    ['HEIC dichiarata image/heic', async () => file(Buffer.from('ftypheic'), 'image/heic', 'ritratto.heic')],
    ['testo dichiarato text/plain', async () => file(Buffer.from('ciao'), 'text/plain', 'ritratto.txt')],
    ['WebP senza tipo dichiarato', async () => file(await webpOf(600, 600), '')],
    ['file vuoto', async () => file(Buffer.alloc(0), 'image/webp')],
    ['campo testo al posto del file', async () => 'non un file'],
    ['foto mancante', async () => null],
  ])('%s → invalid, nessun upload né update', async (_label, makePhoto) => {
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(await makePhoto()));

    expect(result.status).toBe('invalid');
    expectAdminCheckFirst();
    expect(fake.uploads).toEqual([]);
    expect(barberUpdates()).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  test.each([
    ['non valido', 'non-un-uuid'],
    ['mancante', null],
  ])('barberId %s → invalid, nessun upload né update', async (_label, barberId) => {
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp'), {}, barberId));
    expect(result.status).toBe('invalid');
    expect(fake.uploads).toEqual([]);
    expect(barberUpdates()).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // dec. 3 e 5: limite di 1 MB
  test('oltre 1 MB (1048577 byte) → too_large, nessun upload né update', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const big = Buffer.concat([await webpOf(600, 600), Buffer.alloc(MAX_BYTES)]).subarray(0, MAX_BYTES + 1);
    const result = await uploadBarberPhoto(IDLE, photoForm(file(big, 'image/webp')));

    expect(result.status).toBe('too_large');
    expect(fake.uploads).toEqual([]);
    expect(barberUpdates()).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // Punto 6 approvato: il tipo si controlla prima della dimensione
  test('PNG oltre 1 MB dichiarata image/png → invalid (vince il tipo)', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const big = Buffer.concat([await solid(600, 600).png().toBuffer(), Buffer.alloc(MAX_BYTES)]);
    const result = await uploadBarberPhoto(IDLE, photoForm(file(big, 'image/png', 'ritratto.png')));
    expect(result.status).toBe('invalid');
    expect(fake.uploads).toEqual([]);
  });

  // Il limite è incluso: 1048576 byte non è "troppo grande" (qui il contenuto non è un'immagine)
  test('esattamente 1048576 byte non è too_large', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(Buffer.alloc(MAX_BYTES, 0x61), 'image/webp')));
    expect(result.status).toBe('not_image');
    expect(fake.uploads).toEqual([]);
  });

  // dec. 5 + correzione 1: contenuto reale controllato con sharp (solo WebP o JPEG); mai un'eccezione
  const notImages: Array<[string, () => Promise<Buffer>]> = [
    ['testo', async () => Buffer.from('Questo non è un ritratto.\n')],
    ['SVG', async () => SVG],
    ['SVG con prologo XML', async () => Buffer.concat([Buffer.from('<?xml version="1.0"?>\n'), SVG])],
    ['PNG', async () => solid(600, 600).png().toBuffer()],
    ['WebP troncata', async () => (await webpOf(600, 600)).subarray(0, 60)],
  ];
  test.each([
    ...notImages.map(([label, make]) => [label, 'image/webp', make] as const),
    ...notImages.map(([label, make]) => [label, 'image/jpeg', make] as const),
  ])('%s dichiarato %s → not_image, nessun upload né update', async (_label, type, makeBody) => {
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await makeBody(), type)));

    expect(result).toEqual({ status: 'not_image' });
    expectAdminCheckFirst();
    expect(fake.uploads).toEqual([]);
    expect(barberUpdates()).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // dec. 5: se l'update fallisce si rimuove il file appena caricato
  test('update del database fallito → error, file nuovo rimosso, ritratto precedente intatto', async () => {
    fake.failBarbersUpdate = true;
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp')));

    expect(result.status).toBe('error');
    expect(fake.uploads).toHaveLength(1);
    const uploaded = fake.uploads[0]?.path;
    expect(fake.removes.flatMap((remove) => remove.paths)).toEqual([uploaded]);
    expect(snapshot()).toEqual(before);
  });

  // Punto 2 approvato: il barbiere si controlla prima di caricare
  test('barbiere inesistente → error, nessun upload', async () => {
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp'), {}, MISSING));

    expect(result.status).toBe('error');
    expect(fake.uploads).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // Punto 7 approvato: dopo upload e update riusciti, il file vecchio non cancellato non è un errore
  test('errore nel cancellare il file precedente dopo l\'update → saved, photo_path nuovo', async () => {
    fake.failRemove = true;
    const { uploadBarberPhoto } = await photoActions();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp')));

    expect(result.status).toBe('saved');
    expect(barber(LUCA)?.photo_path).toBe(fake.uploads[0]?.path);
    expect(fake.removes.flatMap((remove) => remove.paths)).toEqual([LUCA_OLD]);
  });

  test('upload fallito → error, photo_path e file precedente invariati', async () => {
    fake.failUpload = true;
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp')));

    expect(result.status).toBe('error');
    expect(barberUpdates()).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // dec. 3 e 5: solo l'admin
  test.each([
    ['barbiere', 'barber' as const],
    ['cliente', 'customer' as const],
    ['anonimo', null],
  ])('%s: respinto prima di qualsiasi accesso a storage e database', async (_label, role) => {
    fake.currentRole = role;
    const { uploadBarberPhoto } = await photoActions();
    const before = snapshot();
    await expect(uploadBarberPhoto(IDLE, photoForm(file(await webpOf(600, 600), 'image/webp')))).rejects.toBeDefined();
    expect(fake.log).toContain('requireRole:admin');
    expect(touchedStorageOrDb()).toEqual([]);
    expect(usedServiceRole()).toBe(false);
    expect(snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// removeBarberPhoto (dec. 5)
// ---------------------------------------------------------------------------
describe('removeBarberPhoto – rimozione del ritratto (8d dec. 5)', () => {
  const removeForm = (barberId: string | null, extra: Record<string, string> = {}): FormData =>
    photoForm(null, extra, barberId);

  test('azzera photo_path e cancella il file del barbiere', async () => {
    const { removeBarberPhoto } = await photoActions();
    const result = await removeBarberPhoto(IDLE, removeForm(LUCA));

    expect(result.status).toBe('ok');
    expectAdminCheckFirst();
    expect(usedServiceRole()).toBe(false);
    expect(barber(LUCA)?.photo_path).toBeNull();
    expect(storedPaths()).toEqual([SARA_OLD]);
    expect(fake.removes).toEqual([{ bucket: 'barber-photos', paths: [LUCA_OLD] }]);
    expect(fake.log.indexOf('server:from:barbers:update'), 'prima l\'update, poi il file')
      .toBeLessThan(fake.log.indexOf('server:storage:remove'));
  });

  // Punto 7 approvato: "Rimuovi" senza ritratto → ok, nessuna chiamata allo storage
  test('barbiere senza ritratto → ok, nessuna chiamata allo storage', async () => {
    const { removeBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await removeBarberPhoto(IDLE, removeForm(MARIO));

    expect(result.status).toBe('ok');
    expect(fake.log.filter((event) => event.includes(':storage:'))).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  // dec. 2: il file da cancellare viene dal database, mai dal client
  test('un percorso passato dal client viene ignorato: si cancella solo il file del barbiere', async () => {
    const { removeBarberPhoto } = await photoActions();
    const result = await removeBarberPhoto(IDLE, removeForm(LUCA, { path: SARA_OLD, photoPath: SARA_OLD }));

    expect(result.status).toBe('ok');
    expect(barber(SARA)?.photo_path).toBe(SARA_OLD);
    expect(storedPaths()).toEqual([SARA_OLD]);
    expect(fake.removes.flatMap((remove) => remove.paths)).toEqual([LUCA_OLD]);
  });

  test.each([
    ['non valido', 'non-un-uuid'],
    ['mancante', null],
  ])('barberId %s → invalid, nessuna modifica', async (_label, barberId) => {
    const { removeBarberPhoto } = await photoActions();
    const before = snapshot();
    const result = await removeBarberPhoto(IDLE, removeForm(barberId));
    expect(result.status).toBe('invalid');
    expect(barberUpdates()).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  test.each([
    ['barbiere', 'barber' as const],
    ['cliente', 'customer' as const],
    ['anonimo', null],
  ])('%s: respinto prima di qualsiasi accesso a storage e database', async (_label, role) => {
    fake.currentRole = role;
    const { removeBarberPhoto } = await photoActions();
    const before = snapshot();
    await expect(removeBarberPhoto(IDLE, removeForm(LUCA))).rejects.toBeDefined();
    expect(fake.log).toContain('requireRole:admin');
    expect(touchedStorageOrDb()).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// deleteBarber e saveBarber (dec. 5)
// ---------------------------------------------------------------------------
describe('Scheda del barbiere e ritratto (8d dec. 5)', () => {
  const barberActions = async (): Promise<BarberActionsModule> => load<BarberActionsModule>(BARBER_ACTIONS);
  const idForm = (id: string): FormData => photoForm(null, { id }, null);

  test('deleteBarber riuscito cancella anche il file del ritratto', async () => {
    const { deleteBarber } = await barberActions();
    const result = await deleteBarber(IDLE, idForm(SARA));

    expect(result.status).toBe('ok');
    expect(barber(SARA)).toBeUndefined();
    expect(storedPaths()).toEqual([LUCA_OLD]);
    expect(fake.removes).toEqual([{ bucket: 'barber-photos', paths: [SARA_OLD] }]);
    expect(usedServiceRole()).toBe(false);
  });

  test('deleteBarber con prenotazioni → has_bookings, ritratto e file restano', async () => {
    fake.bookings = [{ id: 'bk-1', barber_id: SARA, status: 'confirmed', starts_at: '2040-01-01T09:00:00Z' }];
    const { deleteBarber } = await barberActions();
    const result = await deleteBarber(IDLE, idForm(SARA));

    expect(result.status).toBe('has_bookings');
    expect(barber(SARA)?.photo_path).toBe(SARA_OLD);
    expect(storedPaths()).toContain(SARA_OLD);
    expect(fake.removes).toEqual([]);
  });

  test('deleteBarber: un errore nel cancellare il file dopo l\'eliminazione non fa fallire l\'azione', async () => {
    fake.failRemove = true;
    const { deleteBarber } = await barberActions();
    const result = await deleteBarber(IDLE, idForm(SARA));

    expect(result.status).toBe('ok');
    expect(barber(SARA)).toBeUndefined();
  });

  // dec. 5: la disattivazione non tocca la foto; dec. 1: la scheda non scrive più la foto
  test('saveBarber (anche disattivando) non tocca photo_path né il bucket', async () => {
    const { saveBarber } = await barberActions();
    const data = new FormData();
    data.append('id', LUCA);
    data.append('displayName', 'Luca');
    data.append('bio', '');
    data.append('serviceIds', SERVICE);
    const result = await saveBarber(IDLE, data);

    expect(result.status).toBe('saved');
    expect(barber(LUCA)?.is_active).toBe(false);
    expect(barber(LUCA)?.photo_path).toBe(LUCA_OLD);
    for (const update of barberUpdates()) {
      expect(update.payload).not.toHaveProperty('photo_path');
      expect(update.payload).not.toHaveProperty('photo_url');
    }
    expect(fake.uploads).toEqual([]);
    expect(fake.removes).toEqual([]);
    expect(storedPaths()).toEqual([LUCA_OLD, SARA_OLD]);
  });
});

// ---------------------------------------------------------------------------
// Testi e controlli sul codice (dec. 1, 7, 8)
// ---------------------------------------------------------------------------
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = resolve(ROOT, 'src');
const CODE = /\.(ts|tsx)$/;

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (CODE.test(entry)) out.push(path);
  }
  return out;
};
const rel = (path: string): string => relative(ROOT, path).split(sep).join('/');

const string = async (path: string): Promise<unknown> => {
  const { it: strings } = await load<{ it: unknown }>('@/i18n/it');
  let node: unknown = strings;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

describe('Testi e codice del ritratto (8d dec. 1, 7, 8)', () => {
  // dec. 7: alt "Ritratto di <nome>" in src/i18n/it.ts
  test('it.booking.barber.portraitAlt è "Ritratto di {name}"', async () => {
    expect(await string('booking.barber.portraitAlt')).toBe('Ritratto di {name}');
  });

  // dec. 8: chiavi della sezione "Ritratto" della scheda
  test.each([
    'admin.barbers.portraitTitle',
    'admin.barbers.portraitLabel',
    'admin.barbers.portraitUpload',
    'admin.barbers.portraitRemove',
    'admin.barbers.portraitTooLarge',
    'admin.barbers.portraitNotImage',
  ])('it.%s è una stringa non vuota', async (path) => {
    const value = await string(path);
    expect(value, `chiave i18n mancante: it.${path}`).toBeTypeOf('string');
    expect(String(value).trim()).not.toBe('');
  });

  test('i messaggi di errore del ritratto sono distinti fra loro e dall\'errore generico', async () => {
    const values = await Promise.all(
      ['admin.barbers.portraitTooLarge', 'admin.barbers.portraitNotImage', 'admin.common.invalid', 'admin.common.error'].map(string),
    );
    expect(new Set(values).size).toBe(values.length);
  });

  // dec. 1: via il campo URL della foto
  test('photo_url e photoUrlLabel non esistono più in src/', async () => {
    expect(await string('admin.barbers.photoUrlLabel')).toBeUndefined();
    const offending = walk(SRC).filter((path) => /\bphoto_url\b/.test(readFileSync(path, 'utf8'))).map(rel);
    expect(offending).toEqual([]);
  });

  // dec. 7: niente ottimizzazione di Next per i ritratti, quindi nessun remotePatterns
  test('next.config non dichiara remotePatterns', () => {
    const config = ['next.config.ts', 'next.config.mjs', 'next.config.js']
      .map((name) => resolve(ROOT, name))
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(config).not.toMatch(/remotePatterns/);
  });

  // Correzione 2: il file (fino a 1 MB) passa dal body della server action, limite di Next 1 MB
  test('next.config imposta experimental.serverActions.bodySizeLimit a 2 MB', async () => {
    const path = resolve(ROOT, 'next.config.ts');
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as { default: unknown };
    const config = (typeof loaded.default === 'function'
      ? await (loaded.default as (phase: string, ctx: unknown) => unknown)('phase-production-build', { defaultConfig: {} })
      : loaded.default) as { experimental?: { serverActions?: { bodySizeLimit?: unknown } } };
    expect([`2mb`, 2 * 1024 * 1024]).toContain(config.experimental?.serverActions?.bodySizeLimit);
  });

  // Correzione 3 + punto 3 approvato: bucket e policy in una migrazione, senza alter table sullo
  // schema storage (tabelle di Supabase: db push fallirebbe)
  test('la migrazione del bucket barber-photos non fa alter table su storage.*', () => {
    const dir = resolve(ROOT, 'supabase', 'migrations');
    const migrations = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(resolve(dir, name), 'utf8') }))
      .filter(({ sql }) => sql.includes('barber-photos'));
    expect(migrations.length, 'nessuna migrazione crea il bucket barber-photos').toBeGreaterThan(0);
    for (const { name, sql } of migrations) {
      expect(sql, name).not.toMatch(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?"?storage"?\s*\./i);
    }
  });

  // Correzione 4 + punto 4 approvato: sharp dipendenza esplicita, compatibile con next 16.3.8 (^0.35.4)
  test('package.json ha sharp in dependencies con versione minima 0.35.x ≥ 0.35.4', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    const range = pkg.dependencies?.sharp;
    expect(range, 'sharp mancante in dependencies').toBeTypeOf('string');
    const match = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(String(range).trim());
    expect(match, `range non riconosciuto: ${range}`).not.toBeNull();
    const [major, minor, patch] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
    expect({ major, minor }).toEqual({ major: 0, minor: 35 });
    expect(patch).toBeGreaterThanOrEqual(4);
  });

  // dec. 5: server action; CLAUDE.md – Sicurezza: niente service_role
  test('barber-photo-actions.ts è un modulo "use server" che non importa il client service_role', () => {
    const path = resolve(SRC, 'lib', 'admin', 'barber-photo-actions.ts');
    expect(existsSync(path), 'file mancante: src/lib/admin/barber-photo-actions.ts').toBe(true);
    const code = readFileSync(path, 'utf8');
    expect(code.trimStart()).toMatch(/^["']use server["']/);
    expect(code).not.toMatch(/@\/lib\/db\/admin/);
  });
});
