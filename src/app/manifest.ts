import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SnowyChat',
    short_name: 'SnowyChat',
    description: 'Minecraft AFK bot control panel',
    start_url: '/',
    display: 'standalone',
    background_color: '#080a12',
    theme_color: '#080a12',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
