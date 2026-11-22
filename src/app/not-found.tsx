import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="glass max-w-sm p-8">
        <p className="label">404</p>
        <h1 className="mt-3 text-2xl font-semibold">Halaman tidak ditemukan</h1>
        <Link href="/" className="btn btn-primary mt-6">
          Kembali ke dashboard
        </Link>
      </div>
    </main>
  );
}
