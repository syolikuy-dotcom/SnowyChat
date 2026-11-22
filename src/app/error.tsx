'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="glass max-w-sm p-8">
        <p className="label">Error</p>
        <h1 className="mt-3 text-2xl font-semibold">Terjadi kesalahan</h1>
        <p className="mt-2 text-sm text-(--muted)">Halaman gagal dimuat. Coba muat ulang.</p>
        <button type="button" onClick={reset} className="btn btn-primary mt-6">
          Muat ulang
        </button>
      </div>
    </main>
  );
}
