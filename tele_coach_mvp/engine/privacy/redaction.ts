const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX =
  /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;
const UK_POSTCODE_REGEX =
  /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi;
const US_ZIP_REGEX = /\b\d{5}(?:-\d{4})?\b/g;
const COMPANY_NUMBER_REGEX =
  /\b(?:company(?:\s+registration)?\s*(?:no|number)\s*[:#]?\s*)?\d{7,8}\b/gi;

export function redactSensitiveText(text: string): string {
  return text
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(PHONE_REGEX, "[REDACTED_PHONE]")
    .replace(UK_POSTCODE_REGEX, "[REDACTED_POSTCODE]")
    .replace(US_ZIP_REGEX, "[REDACTED_POSTCODE]")
    .replace(COMPANY_NUMBER_REGEX, "[REDACTED_COMPANY_NUMBER]");
}
