import { Env, ReceiptAnalysis, AiProvider } from '../types';

const SYSTEM_PROMPT = `You are a receipt and expense analysis AI. Given receipt content (either an image, PDF, or email text), extract structured data.

Return a JSON object with these fields:
- merchant: string (business name)
- amount: number (total amount paid)
- currency: string (3-letter currency code, default "USD")
- date: string (ISO date format YYYY-MM-DD)
- category: string (one of: "Food & Dining", "Transportation", "Office Supplies", "Technology", "Travel", "Utilities", "Entertainment", "Health & Medical", "Insurance", "Professional Services", "Marketing & Advertising", "Rent & Lease", "Subscriptions", "Taxes & Fees", "Education & Training", "Shipping & Postage", "Repairs & Maintenance", "Other")
- subcategory: string or null (more specific category)
- description: string (brief description of the purchase)
- payment_method: string or null (e.g., "Visa ending 4242", "PayPal", "Cash")
- tax_amount: number or null
- tip_amount: number or null
- receipt_number: string or null (receipt number, confirmation number, or order number if present)
- invoice_number: string or null (invoice number if present, distinct from receipt number)
- line_items: array of { description: string, quantity: number, unit_price: number, total: number }
- confidence: number (0-1, your confidence in the extraction accuracy)
- tax_deductible: boolean (true if this expense is likely tax-deductible as a business expense for a self-employed person or small business, false otherwise. Most business-related expenses are deductible. Personal expenses like personal meals, entertainment, or personal shopping are NOT deductible.)
- tax_category: string or null (if tax_deductible is true, assign one of these IRS Schedule C categories: "Advertising", "Car & Truck Expenses", "Commissions & Fees", "Contract Labor", "Depreciation", "Employee Benefits", "Insurance", "Interest (Mortgage/Other)", "Legal & Professional", "Office Expense", "Pension & Profit-Sharing", "Rent (Vehicles/Equipment/Other)", "Repairs & Maintenance", "Supplies", "Taxes & Licenses", "Travel", "Meals", "Utilities", "Wages", "Other Expenses". If not deductible, set to null.)

Return ONLY valid JSON, no markdown or explanation.`;

export async function analyzeReceiptImage(
  imageData: ArrayBuffer, contentType: string, apiKey: string, provider: AiProvider = 'anthropic'
): Promise<ReceiptAnalysis> {
  if (provider === 'openai') {
    return analyzeWithOpenAIVision(imageData, contentType, apiKey);
  }
  return analyzeWithAnthropicVision(imageData, contentType, apiKey);
}

export async function analyzeReceiptPdf(
  pdfData: ArrayBuffer, apiKey: string, provider: AiProvider = 'anthropic'
): Promise<ReceiptAnalysis> {
  if (provider === 'openai') {
    return analyzeWithOpenAIPdf(pdfData, apiKey);
  }
  return analyzeWithAnthropicPdf(pdfData, apiKey);
}

export async function analyzeReceiptEmail(
  emailBody: string, subject: string, from: string, apiKey: string, provider: AiProvider = 'anthropic'
): Promise<ReceiptAnalysis> {
  const prompt = `Please analyze this email receipt and extract all relevant data.\n\nFrom: ${from}\nSubject: ${subject}\n\n${emailBody}`;

  if (provider === 'openai') {
    return callOpenAI(apiKey, [{ role: 'user', content: prompt }]);
  }
  return callAnthropic(apiKey, [{ role: 'user', content: prompt }]);
}

// --- Anthropic ---

async function analyzeWithAnthropicVision(imageData: ArrayBuffer, contentType: string, apiKey: string): Promise<ReceiptAnalysis> {
  const base64 = arrayBufferToBase64(imageData);
  const mediaType = contentType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

  return callAnthropic(apiKey, [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Please analyze this receipt and extract all relevant data.' },
    ],
  }]);
}

async function analyzeWithAnthropicPdf(pdfData: ArrayBuffer, apiKey: string): Promise<ReceiptAnalysis> {
  const base64 = arrayBufferToBase64(pdfData);

  return callAnthropic(apiKey, [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: 'Please analyze this receipt/invoice PDF and extract all relevant data.' },
    ],
  }]);
}

async function callAnthropic(apiKey: string, messages: unknown[]): Promise<ReceiptAnalysis> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // 4096 tokens covers receipts with long descriptions or many line items.
      // 1024 was truncating mid-JSON for emailed invoices and producing unparseable output.
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errText}`);
  }

  const result = await response.json<{ content: Array<{ type: string; text: string }> }>();
  const text = result.content.find(c => c.type === 'text')?.text || '';
  return parseAnalysisResponse(text);
}

// --- OpenAI ---

async function analyzeWithOpenAIVision(imageData: ArrayBuffer, contentType: string, apiKey: string): Promise<ReceiptAnalysis> {
  const base64 = arrayBufferToBase64(imageData);
  const dataUrl = `data:${contentType};base64,${base64}`;

  return callOpenAI(apiKey, [{
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: dataUrl } },
      { type: 'text', text: 'Please analyze this receipt and extract all relevant data.' },
    ],
  }]);
}

async function analyzeWithOpenAIPdf(pdfData: ArrayBuffer, apiKey: string): Promise<ReceiptAnalysis> {
  const base64 = arrayBufferToBase64(pdfData);

  return callOpenAI(apiKey, [{
    role: 'user',
    content: [
      { type: 'file', file: { filename: 'receipt.pdf', file_data: `data:application/pdf;base64,${base64}` } },
      { type: 'text', text: 'Please analyze this receipt/invoice PDF and extract all relevant data.' },
    ],
  }]);
}

async function callOpenAI(apiKey: string, messages: unknown[]): Promise<ReceiptAnalysis> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // response_format guarantees JSON output without markdown fences, eliminating
      // one whole class of parser failure. max_tokens raised to 4096 to match Anthropic.
      model: 'gpt-4o',
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const result = await response.json<{
    choices: Array<{ message: { content: string } }>;
  }>();

  const text = result.choices?.[0]?.message?.content || '';
  return parseAnalysisResponse(text);
}

// --- Shared ---

function parseAnalysisResponse(text: string): ReceiptAnalysis {
  let cleaned = text.trim();
  // Permissive markdown-fence stripping: handles ```, ```json, ``` json, with or
  // without trailing newlines/whitespace on either side.
  cleaned = cleaned.replace(/^```\s*\w*\s*\n?/i, '').replace(/\s*```\s*$/i, '').trim();
  // If there's prose around the JSON (which response_format=json_object on OpenAI
  // already prevents, but Anthropic can still emit), extract the first balanced
  // {...} block.
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // Throw rather than returning empty data marked as "successful". The workflow's
    // outer catch will land the receipt at status='failed' with a clear note so the
    // user sees a real failure they can retry — not a silently-empty success.
    const detail = err instanceof Error ? err.message : 'unknown JSON error';
    throw new Error(`AI returned unparseable response (${detail}); manual entry or retry required`);
  }

  return {
    merchant: (parsed.merchant as string) || null,
    amount: typeof parsed.amount === 'number' ? parsed.amount : null,
    currency: (parsed.currency as string) || 'USD',
    date: (parsed.date as string) || null,
    category: (parsed.category as string) || 'Other',
    subcategory: (parsed.subcategory as string) || null,
    description: (parsed.description as string) || null,
    payment_method: (parsed.payment_method as string) || null,
    tax_amount: typeof parsed.tax_amount === 'number' ? parsed.tax_amount : null,
    tip_amount: typeof parsed.tip_amount === 'number' ? parsed.tip_amount : null,
    receipt_number: (parsed.receipt_number as string) || null,
    invoice_number: (parsed.invoice_number as string) || null,
    line_items: Array.isArray(parsed.line_items) ? (parsed.line_items as ReceiptAnalysis['line_items']) : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    tax_deductible: parsed.tax_deductible === true,
    tax_category: parsed.tax_deductible === true && parsed.tax_category ? (parsed.tax_category as string) : null,
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
