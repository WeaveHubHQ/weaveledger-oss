export interface Env {
  DB: D1Database;
  RECEIPTS_BUCKET: R2Bucket;
  JWT_SECRET: string;
  CLAUDE_API_KEY: string;
  ANTHROPIC_BASE_URL?: string;  // Anthropic-compatible endpoint override. WeaveHub AI: "https://ai.weavehub.app" with a wh_ai_ key in CLAUDE_API_KEY.
  OPENAI_API_KEY: string;
  RECEIPT_WORKFLOW?: Workflow;            // absent on platform (dispatch-namespace) tenant workers — inline processing is used
  DISPATCH_SECRET?: string;               // platform mode: authenticates internal calls from the dispatcher
  HOSTED_PLATFORM?: string;               // "1" on hosted tenants: iOS app entitlement is included in the plan
  GOOGLE_PLAY_WEBHOOK_SECRET: string;
  SEND_EMAIL?: { send: (message: OutboundEmail) => Promise<void> };  // absent on platform tenant workers
  SUBSCRIPTION_ENFORCEMENT?: string;  // "licensing" | "apple" | "none" (default: treat as "none")
  REGISTRATION?: string;              // "open" (default) | "first_user" | "invite" — who may create accounts
  APPLE_BUNDLE_ID?: string;           // "app.weavehub.WeaveLedger"
  LICENSING_URL?: string;             // "https://licensing.weavehub.app" (for SUBSCRIPTION_ENFORCEMENT=licensing)
  LICENSING_API_KEY?: string;         // Shared secret for authenticating with the licensing worker
}

// Cloudflare Email Service (April 2026 public beta) outbound message shape.
// Used via the `send_email` Worker binding declared in wrangler.toml.
export interface OutboundEmail {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
}

export type AiProvider = 'anthropic' | 'openai' | 'weavehub';

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: 'owner' | 'viewer';
  created_at: string;
  updated_at: string;
}

export interface Book {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface BookShare {
  id: string;
  book_id: string;
  user_id: string;
  permission: 'reader' | 'member' | 'admin';
  created_at: string;
}

export interface Invitation {
  id: string;
  book_id: string;
  invited_by: string;
  email: string;
  role: 'reader' | 'member' | 'admin';
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  accepted_at: string | null;
}

export interface Receipt {
  id: string;
  book_id: string;
  user_id: string;
  merchant: string | null;
  amount: number | null;
  currency: string;
  date: string | null;
  category: string | null;
  subcategory: string | null;
  description: string | null;
  payment_method: string | null;
  tax_amount: number | null;
  tip_amount: number | null;
  notes: string | null;
  source: 'camera' | 'email' | 'manual' | 'upload';
  image_key: string | null;
  raw_email: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  ai_confidence: number | null;
  tax_deductible: number;
  tax_category: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  book_id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  parent_id: string | null;
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
  tv?: number; // token_version — tokens with stale tv are rejected on password/MFA change
}

export interface ReceiptAnalysis {
  merchant: string | null;
  amount: number | null;
  currency: string;
  date: string | null;
  category: string;
  subcategory: string | null;
  description: string | null;
  payment_method: string | null;
  tax_amount: number | null;
  tip_amount: number | null;
  receipt_number: string | null;
  invoice_number: string | null;
  line_items: LineItem[];
  confidence: number;
  tax_deductible: boolean;
  tax_category: string | null;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export type ExportFormat = 'csv' | 'json' | 'pdf' | 'qbo' | 'ofx';
