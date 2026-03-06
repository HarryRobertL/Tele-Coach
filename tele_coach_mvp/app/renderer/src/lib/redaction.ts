export function redactSensitiveText(text: string): string {
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phoneRegex =
    /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;
  const ukPostcodeRegex =
    /\b(?:GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/gi;
  const usZipRegex = /\b\d{5}(?:-\d{4})?\b/g;
  const companyNumberRegex =
    /\b(?:company(?:\s+registration)?\s*(?:no|number)\s*[:#]?\s*)?\d{7,8}\b/gi;

  return text
    .replace(emailRegex, "[REDACTED_EMAIL]")
    .replace(phoneRegex, "[REDACTED_PHONE]")
    .replace(ukPostcodeRegex, "[REDACTED_POSTCODE]")
    .replace(usZipRegex, "[REDACTED_POSTCODE]")
    .replace(companyNumberRegex, "[REDACTED_COMPANY_NUMBER]");
}
