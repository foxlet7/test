const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@gdc/shared'],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; connect-src 'self' ${api}; media-src 'self' ${api} blob:; img-src 'self' data:; frame-ancestors 'none'` },
      ],
    }];
  },
};
