import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Runtime {
  manager?: { sessions: Map<string, unknown>; getDbHealth: () => { ready: boolean } };
}

export function GET() {
  const rt = (globalThis as unknown as { __snowychat?: Runtime }).__snowychat;
  const manager = rt?.manager;
  return NextResponse.json({
    ok: true,
    name: 'SnowyChat',
    time: Date.now(),
    sessions: manager?.sessions.size ?? 0,
    dbReady: manager?.getDbHealth().ready ?? false,
  });
}
