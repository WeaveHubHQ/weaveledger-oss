export interface Env {
  DB: D1Database;
  RECEIPTS_BUCKET: R2Bucket;
  JWT_SECRET: string;
  CLAUDE_API_KEY: string;
  OPENAI_API_KEY: string;
  RECEIPT_WORKFLOW: Workflow;
  GOOGLE_PLAY_WEBHOOK_SECRET: string;
  SEND_EMAIL: { send: (message: EmailMessage) => Promise<void> };
  SUBSCRIPTION_ENFORCEMENT?: string;  // "licensing" | "apple" | "none" (default: treat as "none")
  APPLE_BUNDLE_ID?: string;           // "app.weavehub.WeaveLedger"
  LICENSING_URL?: string;             // "https://licensing.weavehub.app" (for SUBSCRIPTION_ENFORCEMENT=licensing)
  LICENSING_API_KEY?: string;         // Shared secret for authenticating with the licensing worker
  ALLOWED_ORIGIN?: string;            // Override default CORS origin (e.g. for a custom web frontend)
  APP_URL?: string;                   // Base URL of your web frontend — used in password reset emails
}

export interface EmailMessage {
  from: { name: string; email: string };
  to: { email: string }[];
  subject: string;
  html: string;
}

export type AiProvider = 'anthropic' | 'openai';

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
