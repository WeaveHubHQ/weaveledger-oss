import { Env, AiProvider } from '../types';
import { analyzeReceiptImage, analyzeReceiptPdf } from '../services/receipt-analyzer';
import { generateId, decryptValue } from '../utils/crypto';
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

interface ReceiptWorkflowParams {
  receiptId: string;
  bookId: string;
  userId: string;
  imageKey?: string;
  emailBody?: string;
  emailSubject?: string;
  emailFrom?: string;
}

export class ReceiptProcessorWorkflow extends WorkflowEntrypoint<Env, ReceiptWorkflowParams> {
  async run(event: WorkflowEvent<ReceiptWorkflowParams>, step: WorkflowStep) {
    const { receiptId, bookId, userId, imageKey, emailBody, emailSubject, emailFrom } = event.payload;

    // Step 1: Mark as processing and get user's AI provider preference + API key
    const { provider, apiKey } = await step.do('mark-processing', async () => {
      await this.env.DB.prepare(
        "UPDATE receipts SET status = 'processing', updated_at = datetime('now') WHERE id = ?"
      ).bind(receiptId).run();

      const user = await this.env.DB.prepare(
        'SELECT ai_provider, anthropic_api_key, openai_api_key FROM users WHERE id = ?'
      ).bind(userId).first<{ ai_provider: AiProvider; anthropic_api_key: string | null; openai_api_key: string | null }>();

      const prov = (user?.ai_provider || 'anthropic') as AiProvider;
      const encryptedKey = prov === 'anthropic' ? user?.anthropic_api_key : user?.openai_api_key;
      let key: string;

      if (encryptedKey) {
        try { key = await decryptValue(encryptedKey, this.env.JWT_SECRET); }
        catch { key = prov === 'anthropic' ? this.env.CLAUDE_API_KEY : this.env.OPENAI_API_KEY; }
      } else {
        key = prov === 'anthropic' ? this.env.CLAUDE_API_KEY : this.env.OPENAI_API_KEY;
      }

      return { provider: prov, apiKey: key };
    });

    // Step 2: Analyze the receipt
    let analysis;
    try {
      analysis = await step.do('analyze-receipt', async () => {
        if (imageKey) {
          const object = await this.env.RECEIPTS_BUCKET.get(imageKey);
          if (!object) throw new Error('Image not found in R2');
          const contentType = object.httpMetadata?.contentType || 'image/jpeg';

          if (contentType === 'application/pdf' || imageKey.endsWith('.pdf')) {
            // PDFs — use native PDF support from AI provider
            const pdfData = await object.arrayBuffer();
            return await analyzeReceiptPdf(pdfData, apiKey, provider);
          }

          const imageData = await object.arrayBuffer();
          return await analyzeReceiptImage(imageData, contentType, apiKey, provider);
        } else if (emailBody) {
          const { analyzeReceiptEmail } = await import('../services/receipt-analyzer');
          return await analyzeReceiptEmail(emailBody, emailSubject || '', emailFrom || '', apiKey, provider);
        } else {
          throw new Error('No image or email body provided');
        }
      });
    } catch (err) {
      await step.do('mark-failed', async () => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        await this.env.DB.prepare(
          "UPDATE receipts SET status = 'failed', notes = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(`Analysis failed: ${message.slice(0, 500)}`, receiptId).run();
      });
      return { receiptId, status: 'failed' };
    }

    // Step 3: Check for duplicates by receipt/invoice number
    const duplicate = await step.do('check-duplicates', async () => {
      if (!analysis.receipt_number && !analysis.invoice_number) return null;

      const conditions: string[] = [];
      const params: string[] = [bookId, receiptId];

      if (analysis.receipt_number) {
        conditions.push('receipt_number = ?');
        params.push(analysis.receipt_number);
      }
      if (analysis.invoice_number) {
        conditions.push('invoice_number = ?');
        params.push(analysis.invoice_number);
      }

      const existing = await this.env.DB.prepare(
        `SELECT id, merchant, receipt_number, invoice_number FROM receipts
         WHERE book_id = ? AND id != ? AND (${conditions.join(' OR ')})`
      ).bind(...params).first<{ id: string; merchant: string; receipt_number: string; invoice_number: string }>();

      return existing || null;
    });

    // Step 4: Save analysis results
    await step.do('save-results', async () => {
      const duplicateNote = duplicate
        ? `Possible duplicate of receipt ${duplicate.id} (${duplicate.merchant || 'unknown merchant'})`
        : null;

      const statements = [
        this.env.DB.prepare(
          `UPDATE receipts SET
            merchant = ?, amount = ?, currency = ?, date = ?, category = ?,
            subcategory = ?, description = ?, payment_method = ?,
            tax_amount = ?, tip_amount = ?, ai_confidence = ?,
            receipt_number = ?, invoice_number = ?,
            tax_deductible = ?, tax_category = ?,
            notes = CASE WHEN ? IS NOT NULL THEN ? ELSE notes END,
            status = 'completed', updated_at = datetime('now')
           WHERE id = ?`
        ).bind(
          analysis.merchant, analysis.amount, analysis.currency, analysis.date,
          analysis.category, analysis.subcategory, analysis.description,
          analysis.payment_method, analysis.tax_amount, analysis.tip_amount,
          analysis.confidence, analysis.receipt_number, analysis.invoice_number,
          analysis.tax_deductible ? 1 : 0, analysis.tax_category,
          duplicateNote, duplicateNote, receiptId
        ),
      ];

      if (analysis.line_items && analysis.line_items.length > 0) {
        for (const item of analysis.line_items) {
          const itemId = generateId('li');
          statements.push(
            this.env.DB.prepare(
              'INSERT INTO line_items (id, receipt_id, description, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(itemId, receiptId, item.description, item.quantity, item.unit_price, item.total)
          );
        }
      }

      await this.env.DB.batch(statements);
    });

    return {
      receiptId,
      status: 'completed',
      analysis,
      duplicate: duplicate ? { id: duplicate.id, merchant: duplicate.merchant } : null,
    };
  }
}
