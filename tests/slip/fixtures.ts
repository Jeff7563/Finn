/**
 * Creates a synthetic JPEG buffer with valid magic bytes (FF D8 FF)
 * and embedded test slip data for deterministic offline testing.
 */
export function createSyntheticSlipJpeg(data: {
  amount: number;
  currency?: "THB";
  transactionDate?: string;
  sender?: {
    name?: string;
    bank?: string;
    accountMasked?: string;
  };
  receiver?: {
    name?: string;
    bank?: string;
    accountMasked?: string;
  };
  reference?: string;
  channel?: string;
  amountConfidence?: number;
  dateConfidence?: number;
  senderAccountConfidence?: number;
  receiverAccountConfidence?: number;
  referenceConfidence?: number;
}): Buffer {
  // JPEG Header: FF D8 FF E0
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const jsonData = JSON.stringify({
    amount: data.amount,
    currency: data.currency || "THB",
    transactionDate: data.transactionDate || new Date().toISOString(),
    sender: data.sender,
    receiver: data.receiver,
    reference: data.reference || `REF-${Math.random().toString(36).substring(2, 9).toUpperCase()}`,
    channel: data.channel || "Mobile Banking",
    amountConfidence: data.amountConfidence ?? 0.99,
    dateConfidence: data.dateConfidence ?? 0.99,
    senderAccountConfidence: data.senderAccountConfidence ?? 0.99,
    receiverAccountConfidence: data.receiverAccountConfidence ?? 0.99,
    referenceConfidence: data.referenceConfidence ?? 0.99,
  });

  const payload = Buffer.from(`\nFINN_SYNTHETIC_SLIP:${jsonData}\n`, "utf-8");
  // JPEG EOI (End of Image): FF D9
  const trailer = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([header, payload, trailer]);
}

/**
 * Creates a synthetic PNG buffer with valid magic bytes (89 50 4E 47 0D 0A 1A 0A).
 */
export function createSyntheticSlipPng(payloadText: string): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const content = Buffer.from(payloadText, "utf-8");
  return Buffer.concat([header, content]);
}
