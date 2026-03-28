export function termsOfServicePage(): Response {
  return new Response(legalPageShell('Terms of Service', termsContent()), {
    headers: legalHeaders(),
  });
}

export function privacyPolicyPage(): Response {
  return new Response(legalPageShell('Privacy Policy', privacyContent()), {
    headers: legalHeaders(),
  });
}

function legalHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/html;charset=UTF-8',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com https://fonts.googleapis.com; img-src 'self' data:; frame-ancestors 'none'",
  };
}

function legalPageShell(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — WeaveLedger</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect x='20' y='10' width='60' height='80' rx='6' fill='%23BF9B30'/><rect x='32' y='28' width='36' height='4' rx='2' fill='%23fff'/><rect x='32' y='40' width='28' height='4' rx='2' fill='%23fff' opacity='.8'/><rect x='32' y='52' width='32' height='4' rx='2' fill='%23fff' opacity='.6'/><rect x='32' y='64' width='24' height='4' rx='2' fill='%23fff' opacity='.4'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --navy:#0a1628;--navy-mid:#132240;
  --gold:#c9a84c;--gold-light:#e4cc7a;--gold-dim:#8a7234;
  --cream:#f5f0e8;--cream-dark:#e8e0d0;--white:#fefcf9;
  --text:#1a1a1a;--text-light:#6b7280;
  --radius:6px;
  --font-display:'DM Serif Display',Georgia,serif;
  --font-body:'DM Sans',-apple-system,sans-serif;
}
html{scroll-behavior:smooth}
body{font-family:var(--font-body);color:var(--text);background:var(--cream);line-height:1.7;-webkit-font-smoothing:antialiased}

.legal-nav{background:rgba(10,22,40,.97);backdrop-filter:blur(12px);border-bottom:1px solid rgba(201,168,76,.15);padding:0 32px;height:64px;display:flex;align-items:center;justify-content:center}
.legal-nav-inner{max-width:800px;width:100%;display:flex;align-items:center;justify-content:space-between}
.legal-nav a.logo{font-family:var(--font-display);font-size:1.35rem;color:var(--cream);text-decoration:none;letter-spacing:-.02em}
.legal-nav a.logo span{color:var(--gold)}
.legal-nav-links{display:flex;gap:20px}
.legal-nav-links a{color:rgba(245,240,232,.6);text-decoration:none;font-size:.85rem;font-weight:500;transition:color .2s}
.legal-nav-links a:hover{color:var(--gold-light)}

.legal-container{max-width:800px;margin:0 auto;padding:48px 32px 80px}
.legal-container h1{font-family:var(--font-display);font-size:2rem;color:var(--navy);margin-bottom:8px;letter-spacing:-.02em}
.legal-meta{color:var(--text-light);font-size:.88rem;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid var(--cream-dark)}
.legal-container h2{font-family:var(--font-display);font-size:1.3rem;color:var(--navy);margin-top:36px;margin-bottom:12px}
.legal-container p{margin-bottom:16px;font-size:.95rem;color:#2a2a2a}
.legal-container ul{margin:0 0 16px 24px;font-size:.95rem}
.legal-container li{margin-bottom:6px;color:#2a2a2a}
.legal-container a{color:var(--gold-dim);text-decoration:underline;text-decoration-color:rgba(138,114,52,.3);transition:text-decoration-color .2s}
.legal-container a:hover{text-decoration-color:var(--gold)}
.legal-container strong{font-weight:600}

footer{background:var(--navy);padding:48px 32px;border-top:1px solid rgba(201,168,76,.1)}
.footer-inner{max-width:800px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
.footer-logo{font-family:var(--font-display);font-size:1.1rem;color:var(--cream)}
.footer-logo span{color:var(--gold)}
footer p{color:rgba(245,240,232,.35);font-size:.85rem}
.footer-links{display:flex;gap:20px}
.footer-links a{color:rgba(245,240,232,.45);text-decoration:none;font-size:.82rem;transition:color .2s}
.footer-links a:hover{color:var(--gold-light)}

@media(max-width:640px){
  .legal-container{padding:32px 20px 60px}
  .legal-container h1{font-size:1.6rem}
  .legal-nav-links{gap:12px}
  .footer-inner{flex-direction:column;text-align:center}
}
</style>
</head>
<body>

<nav class="legal-nav">
  <div class="legal-nav-inner">
    <a href="/" class="logo">Weave<span>Ledger</span></a>
    <div class="legal-nav-links">
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </div>
  </div>
</nav>

<main class="legal-container">
${content}
</main>

<footer>
  <div class="footer-inner">
    <div class="footer-logo">Weave<span>Ledger</span></div>
    <div class="footer-links">
      <a href="/terms">Terms of Service</a>
      <a href="/privacy">Privacy Policy</a>
    </div>
    <p>&copy; 2026 WeaveLedger</p>
  </div>
</footer>

</body>
</html>`;
}

function termsContent(): string {
  return `<h1>Terms of Service</h1>
<p class="legal-meta">Effective date: March 10, 2026</p>

<p>Welcome to WeaveLedger. These Terms of Service ("Terms") govern your use of the WeaveLedger application, website, and related services (collectively, the "Service") operated by WeaveLedger ("we," "us," or "our"). By creating an account or using the Service, you agree to be bound by these Terms.</p>

<h2>1. Description of Service</h2>
<p>WeaveLedger is a receipt tracking and expense management application designed for small businesses. The Service includes receipt capture and storage, expense categorization, income tracking, budget management, tax categorization, recurring expense tracking, subscription monitoring, book sharing, and data export capabilities. The Service is provided via an iOS application and a web-based API.</p>

<h2>2. Account Registration</h2>
<p>To use the Service, you must create an account by providing a valid email address and password. You are responsible for:</p>
<ul>
  <li>Providing accurate and complete registration information</li>
  <li>Maintaining the confidentiality of your account credentials</li>
  <li>All activity that occurs under your account</li>
  <li>Notifying us immediately of any unauthorized access to your account</li>
</ul>
<p>You may optionally enable multi-factor authentication (MFA) for additional account security. We strongly recommend doing so.</p>

<h2>3. Acceptable Use</h2>
<p>You agree to use the Service only for lawful purposes and in accordance with these Terms. You agree not to:</p>
<ul>
  <li>Use the Service to store, transmit, or process any illegal, fraudulent, or deceptive content</li>
  <li>Attempt to gain unauthorized access to the Service, other accounts, or related systems</li>
  <li>Interfere with or disrupt the Service or its infrastructure</li>
  <li>Upload malicious files, viruses, or harmful code</li>
  <li>Use the Service to violate any applicable law or regulation</li>
  <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
  <li>Use automated means (bots, scrapers) to access the Service without our written permission</li>
  <li>Resell, sublicense, or redistribute access to the Service</li>
</ul>

<h2>4. User Content</h2>
<p>You retain ownership of all data, receipts, images, and other content you upload to the Service ("User Content"). By uploading User Content, you grant us a limited, non-exclusive license to store, process, and display your content solely for the purpose of providing and improving the Service.</p>
<p>You are responsible for ensuring that your User Content does not infringe on the rights of any third party and complies with all applicable laws.</p>

<h2>5. AI Processing</h2>
<p>The Service uses artificial intelligence to analyze receipt images for data extraction, including merchant name, amounts, dates, and categories. AI processing is performed to assist you and is not guaranteed to be perfectly accurate. You are responsible for reviewing and correcting any AI-extracted data. We do not use your receipt images or data to train AI models for purposes unrelated to providing the Service.</p>

<h2>6. Email Forwarding</h2>
<p>The Service allows you to forward receipt emails for automatic processing. By using this feature, you acknowledge that forwarded emails will be processed by our systems to extract receipt data. You should only forward emails that you are authorized to share and that contain receipt or transaction information.</p>

<h2>7. Book Sharing</h2>
<p>The Service allows you to share expense books with other users. When you share a book, the invited user will have access to the data within that book according to the permissions you grant. You are responsible for managing who has access to your shared books and revoking access when appropriate.</p>

<h2>8. Third-Party Integrations</h2>
<p>The Service may allow you to connect third-party services (such as Stripe, Google Play, or App Store) for income tracking purposes. You are responsible for providing valid API credentials and ensuring you have authorization to access data from those services. We are not responsible for the availability, accuracy, or security of third-party services.</p>

<h2>9. Intellectual Property</h2>
<p>The Service, including its design, code, features, and documentation, is owned by WeaveLedger and is protected by intellectual property laws. These Terms do not grant you any right to use our trademarks, logos, or branding without written permission.</p>

<h2>10. Service Availability</h2>
<p>We strive to maintain the Service's availability but do not guarantee uninterrupted access. The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We are not liable for any loss or damage resulting from Service downtime.</p>

<h2>11. Disclaimers</h2>
<p>The Service is provided "as is" and "as available" without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
<p>WeaveLedger is not a tax, legal, or financial advisory service. Tax categorizations, deduction tracking, and tax estimates provided by the Service are for informational purposes only and should not be relied upon as professional tax advice. Consult a qualified tax professional for tax-related decisions.</p>

<h2>12. Limitation of Liability</h2>
<p>To the maximum extent permitted by law, WeaveLedger and its operator shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunities arising from your use of the Service.</p>
<p>Our total liability for any claim arising from these Terms or the Service shall not exceed the amount you paid us in the twelve (12) months preceding the claim, or fifty US dollars ($50), whichever is greater.</p>

<h2>13. Indemnification</h2>
<p>You agree to indemnify and hold harmless WeaveLedger and its operator from any claims, damages, losses, or expenses (including reasonable attorney's fees) arising from your use of the Service, your User Content, or your violation of these Terms.</p>

<h2>14. Termination</h2>
<p>You may close your account at any time by contacting us. We may suspend or terminate your access to the Service if you violate these Terms or engage in activity that could harm the Service or other users.</p>
<p>Upon termination, your right to use the Service ceases immediately. We will retain your data in accordance with our <a href="/privacy">Privacy Policy</a> and may delete it after a reasonable retention period unless required by law to retain it.</p>

<h2>15. Changes to These Terms</h2>
<p>We may update these Terms from time to time. When we make material changes, we will notify you by email or through the Service. Your continued use of the Service after changes take effect constitutes acceptance of the updated Terms.</p>

<h2>16. Governing Law</h2>
<p>These Terms are governed by the laws of the United States. Any disputes arising from these Terms or the Service shall be resolved in accordance with applicable federal and state law.</p>

<h2>17. Severability</h2>
<p>If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force and effect.</p>

<h2>18. Contact</h2>
<p>If you have questions about these Terms, please contact us at <strong>support@weavehub.app</strong>.</p>`;
}

function privacyContent(): string {
  return `<h1>Privacy Policy</h1>
<p class="legal-meta">Effective date: March 10, 2026</p>

<p>WeaveLedger ("we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use the WeaveLedger application, website, and related services (the "Service"). By using the Service, you agree to the practices described in this policy.</p>

<h2>1. Information We Collect</h2>

<p><strong>Account Information:</strong> When you create an account, we collect your email address and password. Your password is cryptographically hashed and never stored in plain text. If you enable multi-factor authentication, we store the associated TOTP secret.</p>

<p><strong>Receipt and Expense Data:</strong> We collect data you provide or upload, including receipt images, PDFs, merchant names, transaction amounts, dates, categories, subcategories, payment methods, tax information, and notes. This data is provided by you directly or extracted via AI processing of uploaded images and forwarded emails.</p>

<p><strong>Email Data:</strong> If you use the email forwarding feature, we process the content of forwarded emails to extract receipt information. You may also link additional email addresses to your account for receipt forwarding purposes.</p>

<p><strong>Financial Integration Data:</strong> If you connect third-party services (such as Stripe, Google Play, or App Store), we store the API credentials you provide and the transaction data retrieved from those services.</p>

<p><strong>Usage Data:</strong> We collect basic server logs including IP addresses, request timestamps, and user agent strings for security monitoring and abuse prevention. We do not use analytics or tracking cookies.</p>

<h2>2. How We Use Your Information</h2>
<p>We use the information we collect to:</p>
<ul>
  <li>Provide, maintain, and improve the Service</li>
  <li>Process and analyze receipt images using AI for data extraction</li>
  <li>Authenticate your identity and secure your account</li>
  <li>Process forwarded emails to extract receipt data</li>
  <li>Retrieve income data from connected third-party integrations</li>
  <li>Generate expense reports, tax summaries, and financial exports</li>
  <li>Facilitate book sharing between users you authorize</li>
  <li>Communicate with you about your account or the Service</li>
  <li>Detect and prevent fraud, abuse, or security incidents</li>
  <li>Comply with legal obligations</li>
</ul>
<p>We do not sell your personal information. We do not use your data for advertising. We do not use your receipt images or financial data to train AI models for purposes unrelated to providing you with the Service.</p>

<h2>3. Data Sharing</h2>
<p>We do not sell, rent, or trade your personal information. We may share your data only in the following circumstances:</p>
<ul>
  <li><strong>Service Providers:</strong> We use Cloudflare (Workers, D1 database, R2 storage, Workers AI) to host and operate the Service. These providers process data on our behalf and are bound by their own privacy and security commitments.</li>
  <li><strong>Book Sharing:</strong> When you share an expense book with another user, that user can access the data within the shared book according to the permissions you set.</li>
  <li><strong>Legal Requirements:</strong> We may disclose your information if required by law, legal process, or government request, or to protect the rights, property, or safety of WeaveLedger, our users, or the public.</li>
</ul>

<h2>4. Data Storage and Security</h2>
<p>Your data is stored on Cloudflare's global infrastructure, including:</p>
<ul>
  <li><strong>D1 Database:</strong> Account information, expense records, categories, and settings</li>
  <li><strong>R2 Object Storage:</strong> Receipt images, PDFs, and email attachments</li>
</ul>
<p>We implement the following security measures:</p>
<ul>
  <li>Passwords are hashed using PBKDF2 with SHA-256 and individual salts</li>
  <li>Authentication uses JSON Web Tokens (JWT) with short expiration periods</li>
  <li>Optional multi-factor authentication (TOTP) is available</li>
  <li>API rate limiting protects against brute-force attacks</li>
  <li>All data is transmitted over HTTPS/TLS encryption</li>
  <li>CORS policies restrict API access to authorized origins</li>
</ul>
<p>While we take reasonable measures to protect your data, no system is completely secure. You are responsible for maintaining the security of your account credentials.</p>

<h2>5. Data Retention</h2>
<p>We retain your data for as long as your account is active and as needed to provide the Service. If you delete your account, we will delete your personal data within a reasonable timeframe, except where retention is required by law or necessary for legitimate business purposes (such as resolving disputes or enforcing our Terms).</p>
<p>Receipt images and associated files stored in R2 are deleted when you delete the corresponding receipt or your account.</p>

<h2>6. Your Rights</h2>
<p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
<ul>
  <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
  <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data</li>
  <li><strong>Deletion:</strong> Request deletion of your personal data and account</li>
  <li><strong>Export:</strong> Export your expense data in multiple formats (CSV, JSON, PDF, QBO, OFX)</li>
  <li><strong>Restrict Processing:</strong> Request that we limit how we process your data</li>
  <li><strong>Object:</strong> Object to certain types of data processing</li>
  <li><strong>Withdraw Consent:</strong> Where processing is based on consent, withdraw that consent at any time</li>
</ul>
<p>To exercise any of these rights, contact us at <strong>support@weavehub.app</strong>. We will respond to your request within 30 days.</p>

<h2>7. For EU/EEA Residents (GDPR)</h2>
<p>If you are located in the European Union or European Economic Area, the legal bases for processing your data are:</p>
<ul>
  <li><strong>Contract Performance:</strong> Processing necessary to provide the Service you requested (Article 6(1)(b))</li>
  <li><strong>Legitimate Interests:</strong> Processing for security, fraud prevention, and service improvement (Article 6(1)(f))</li>
  <li><strong>Consent:</strong> Where you have explicitly opted in to specific processing (Article 6(1)(a))</li>
  <li><strong>Legal Obligation:</strong> Processing required to comply with applicable law (Article 6(1)(c))</li>
</ul>
<p>Your data may be transferred to and processed in the United States via Cloudflare's infrastructure. Cloudflare maintains appropriate safeguards for international data transfers. You have the right to lodge a complaint with your local data protection authority.</p>

<h2>8. For California Residents (CCPA)</h2>
<p>If you are a California resident, you have additional rights under the California Consumer Privacy Act:</p>
<ul>
  <li><strong>Right to Know:</strong> You may request details about the categories and specific pieces of personal information we collect</li>
  <li><strong>Right to Delete:</strong> You may request deletion of your personal information</li>
  <li><strong>Right to Opt-Out:</strong> We do not sell personal information, so no opt-out is necessary</li>
  <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your privacy rights</li>
</ul>

<h2>9. Cookies and Tracking</h2>
<p>The Service does not use analytics cookies, tracking pixels, or third-party advertising trackers. We use only essential authentication tokens (JWT) stored in your application to maintain your session. The web application may use localStorage for user preferences (such as display settings), which does not track you across sites.</p>

<h2>10. Children's Privacy</h2>
<p>The Service is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected data from a child under 13, we will delete it promptly. If you believe a child under 13 has provided us with personal information, please contact us at <strong>support@weavehub.app</strong>.</p>

<h2>11. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. When we make material changes, we will notify you by email or through the Service and update the effective date at the top of this page. Your continued use of the Service after changes take effect constitutes acceptance of the updated policy.</p>

<h2>12. Contact</h2>
<p>If you have questions or concerns about this Privacy Policy or our data practices, please contact us at <strong>support@weavehub.app</strong>.</p>`;
}
