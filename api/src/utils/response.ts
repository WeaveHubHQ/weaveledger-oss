const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '0',
  'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
};

export function json(data: unknown, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...securityHeaders,
      ...headers,
    },
  });
}

export function error(message: string, status: number = 400): Response {
  return json({ error: message }, status);
}

export function success(data: unknown, message?: string): Response {
  return json({ data, ...(message ? { message } : {}) });
}
