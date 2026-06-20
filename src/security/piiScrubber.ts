/**
 * Utility for scrubbing PII (email, phone numbers, alphanumeric IDs) 
 * and neutralizing potential LLM prompt injection attempts.
 */

// Regex patterns for PII
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
const PHONE_REGEX = /(\+91[\-\s]?)?[6-9]\d{9}\b|\b\d{10}\b/g; // Matches standard Indian phone numbers (10 digits, optional +91 prefix)
const CUSTOMER_ID_REGEX = /\b(cust|acc|user|id|ref)[\s\-_:]*([a-zA-Z0-9]{6,15})\b/gi;

// Regex patterns to neutralize prompt injections
const PROMPT_INJECTION_KEYWORDS = [
  /ignore\s+(any\s+)?(previous\s+)?instructions/gi,
  /you\s+must\s+now\s+forget/gi,
  /act\s+as\s+a/gi,
  /system\s+prompt/gi,
  /override\s+rules/gi,
  /instead\s+of\s+summarizing/gi
];

export interface ScrubbingResult {
  scrubbedText: string;
  piiRemoved: boolean;
  injectionNeutralized: boolean;
}

/**
 * Scrubs PII and sanitizes potential prompt injection terms from the review content.
 */
export function scrubReviewText(text: string): ScrubbingResult {
  let cleaned = text;
  let piiRemoved = false;
  let injectionNeutralized = false;

  // 1. Scrub Emails
  if (EMAIL_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
    piiRemoved = true;
  }

  // 2. Scrub Phone Numbers
  if (PHONE_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(PHONE_REGEX, '[REDACTED_PHONE]');
    piiRemoved = true;
  }

  // 3. Scrub IDs / Account Codes
  if (CUSTOMER_ID_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(CUSTOMER_ID_REGEX, '[REDACTED_ID]');
    piiRemoved = true;
  }

  // 4. Neutralize Prompt Injection attempts
  for (const regex of PROMPT_INJECTION_KEYWORDS) {
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, '[REDACTED_INSTRUCTION_OVERRIDE]');
      injectionNeutralized = true;
    }
  }

  return {
    scrubbedText: cleaned,
    piiRemoved,
    injectionNeutralized
  };
}
